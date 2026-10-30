import { readFileSync } from "node:fs";
import type { Context } from "hono";
import type { CertificateAuthorityMaterial } from "../iam/device-certificate-authority.js";
import type { DeviceStore } from "../iam/device-store.js";
import { MIN_PROXY_SECRET_LENGTH, createForwardedCertificateReader } from "./forwarded-certificate.js";
import { createMockCertificateReader } from "./mock-certificate.js";

export interface ServerSecurity {
  /**
   * De onde vem o certificado de cliente: `header` (um proxy, como o Traefik, termina o TLS, valida a cadeia contra
   * a CA e repassa o certificado) ou `mock` (só desenvolvimento: finge o certificado de um Dispositivo).
   */
  source: "header" | "mock";
  /** CA que emite os certificados dos Dispositivos. Obrigatória em produção. */
  ca?: CertificateAuthorityMaterial;
  /** Só na fonte `header`: o segredo que o proxy acrescenta e os nomes dos headers. */
  proxy?: { secret: string; certificateHeader?: string; secretHeader?: string };
  /** Só na fonte `mock`: o nome do Dispositivo a simular. */
  mock?: { deviceName: string | undefined };
}

type Env = Record<string, string | undefined>;
type ReadFile = (path: string) => Buffer;

const CA_VARS = ["DEVICE_CA_CERT_FILE", "DEVICE_CA_KEY_FILE"] as const;

function readOrExplain(file: string, read: ReadFile): Buffer {
  try {
    return read(file);
  } catch (err: unknown) {
    throw new Error(`Não foi possível ler o arquivo "${file}": ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

/** A CA vem de dois arquivos que só fazem sentido juntos: os dois, nenhum, ou erro nomeando o que falta. */
function loadCa(env: Env, read: ReadFile): CertificateAuthorityMaterial | undefined {
  const absent = CA_VARS.filter((name) => !env[name]);
  if (absent.length === CA_VARS.length) return undefined;
  if (absent.length > 0) throw new Error(`Configuração incompleta: defina também ${absent.join(", ")}.`);
  return {
    certificatePem: readOrExplain(env.DEVICE_CA_CERT_FILE!, read).toString("utf8"),
    privateKeyPem: readOrExplain(env.DEVICE_CA_KEY_FILE!, read).toString("utf8"),
  };
}

function loadHeaderSource(env: Env, read: ReadFile): ServerSecurity {
  const production = env.NODE_ENV === "production";
  // O segredo é a única trava contra um header forjado, então é obrigatório em qualquer ambiente.
  const required = production ? ["PROXY_SHARED_SECRET", ...CA_VARS] : ["PROXY_SHARED_SECRET"];
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Com CLIENT_CERT_SOURCE=header o servidor exige ${production ? "o segredo do proxy e a CA dos Dispositivos" : "o segredo do proxy"}. Defina: ${missing.join(", ")}.`);
  }
  const secret = env.PROXY_SHARED_SECRET!;
  if (secret.length < MIN_PROXY_SECRET_LENGTH) {
    throw new Error(`PROXY_SHARED_SECRET precisa ter ao menos ${MIN_PROXY_SECRET_LENGTH} caracteres.`);
  }
  return {
    source: "header",
    ca: loadCa(env, read),
    proxy: {
      secret,
      ...(env.CLIENT_CERT_HEADER ? { certificateHeader: env.CLIENT_CERT_HEADER } : {}),
      ...(env.PROXY_SECRET_HEADER ? { secretHeader: env.PROXY_SECRET_HEADER } : {}),
    },
  };
}

/**
 * Lê de onde vem o certificado de cliente. Em produção o servidor só sobe com `CLIENT_CERT_SOURCE=header` e a
 * configuração completa, para a falta dela nunca virar "sem exigência de certificado". Fora de produção, sem
 * nenhuma configuração, ninguém apresenta certificado (só entra quem tem o acesso sem certificado).
 *
 * O Node nunca termina TLS: o certificado chega de um proxy que já o validou contra a CA dos Dispositivos.
 */
export function loadServerSecurity(env: Env = process.env, read: ReadFile = readFileSync): ServerSecurity {
  const production = env.NODE_ENV === "production";
  const source = env.CLIENT_CERT_SOURCE || (production ? undefined : "mock");

  if (source === undefined) {
    throw new Error('Em produção defina CLIENT_CERT_SOURCE=header (o proxy que termina o TLS repassa o certificado do cliente).');
  }
  if (source === "header") return loadHeaderSource(env, read);
  if (source === "mock") {
    // Simular o certificado em produção deixaria entrar qualquer um: o servidor nem sobe.
    if (production) throw new Error("CLIENT_CERT_SOURCE=mock não existe em produção: use header.");
    return { source: "mock", ca: loadCa(env, read), mock: { deviceName: env.DEV_CLIENT_CERT_DEVICE || undefined } };
  }
  throw new Error(`CLIENT_CERT_SOURCE inválido ("${source}"): use "header" ou "mock".`);
}

/** Escolhe o leitor do certificado de cliente de acordo com a fonte configurada. */
export function clientCertificateReader(security: ServerSecurity, deviceStore: DeviceStore): (c: Context) => string | undefined | Promise<string | undefined> {
  if (security.source === "header" && security.proxy) return createForwardedCertificateReader(security.proxy);
  return createMockCertificateReader({ deviceStore, deviceName: security.mock?.deviceName });
}
