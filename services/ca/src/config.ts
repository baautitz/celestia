import { readFileSync } from "node:fs";
import type { Context } from "hono";
import { MIN_SHARED_SECRET_LENGTH } from "./app.js";
import type { CertificateAuthorityMaterial } from "./authority.js";
import type { DeviceStore } from "./device-store.js";
import { createForwardedCertificateReader } from "./forwarded-certificate.js";
import { createMockCertificateReader } from "./mock-certificate.js";

export interface CaConfig {
  port: number;
  /** Chave em comum com o backend do Celestia. */
  sharedSecret: string;
  /** Endereço público da CA (o do proxy com mTLS). */
  publicUrl: string;
  /** Para onde o navegador volta depois de ler o certificado. */
  callbackUrl: string;
  /**
   * De onde vem o certificado de cliente: `header` (um proxy, como o Traefik, termina o TLS, valida a cadeia contra
   * a CA e repassa o certificado) ou `mock` (só desenvolvimento: finge o certificado de um Dispositivo).
   */
  source: "header" | "mock";
  /** CA que emite os certificados dos Dispositivos. Obrigatória em produção. */
  authority?: CertificateAuthorityMaterial;
  /** Só na fonte `header`: o segredo que o proxy acrescenta e os nomes dos headers. */
  proxy?: { secret: string; certificateHeader?: string; secretHeader?: string };
  /** Só na fonte `mock`: o nome do Dispositivo a simular. */
  mock?: { deviceName: string | undefined };
}

type Env = Record<string, string | undefined>;
type ReadFile = (path: string) => Buffer;

const CA_VARS = ["DEVICE_CA_CERT_FILE", "DEVICE_CA_KEY_FILE"] as const;
const DEFAULT_PORT = 3001;

function readOrExplain(file: string, read: ReadFile): Buffer {
  try {
    return read(file);
  } catch (err: unknown) {
    throw new Error(`Não foi possível ler o arquivo "${file}": ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

/** A CA vem de dois arquivos que só fazem sentido juntos: os dois, nenhum, ou erro nomeando o que falta. */
function loadAuthority(env: Env, read: ReadFile): CertificateAuthorityMaterial | undefined {
  const absent = CA_VARS.filter((name) => !env[name]);
  if (absent.length === CA_VARS.length) return undefined;
  if (absent.length > 0) throw new Error(`Configuração incompleta: defina também ${absent.join(", ")}.`);
  return {
    certificatePem: readOrExplain(env.DEVICE_CA_CERT_FILE!, read).toString("utf8"),
    privateKeyPem: readOrExplain(env.DEVICE_CA_KEY_FILE!, read).toString("utf8"),
  };
}

function requireUrl(env: Env, name: string, fallback: string | undefined): string {
  const value = env[name] || fallback;
  if (!value) throw new Error(`Defina ${name}.`);
  try {
    new URL(value);
  } catch {
    throw new Error(`${name} não é uma URL válida ("${value}").`);
  }
  return value;
}

/**
 * Lê a configuração da CA. Em produção ela só sobe com a chave em comum, os endereços, a CA dos Dispositivos e
 * `CA_CERT_SOURCE=header` (com o segredo do proxy), para a falta de configuração nunca virar "sem exigência de
 * certificado". Fora de produção, sem fonte configurada, ninguém apresenta certificado.
 *
 * O Node nunca termina TLS: o certificado chega de um proxy que já o validou contra a CA dos Dispositivos.
 */
export function loadCaConfig(env: Env = process.env, read: ReadFile = readFileSync): CaConfig {
  const production = env.NODE_ENV === "production";
  const port = Number(env.CA_PORT) || DEFAULT_PORT;

  const sharedSecret = env.CA_SHARED_SECRET;
  if (!sharedSecret) throw new Error("Defina CA_SHARED_SECRET (a chave em comum com o backend, mínimo 32 caracteres).");
  if (sharedSecret.length < MIN_SHARED_SECRET_LENGTH) {
    throw new Error(`CA_SHARED_SECRET precisa ter ao menos ${MIN_SHARED_SECRET_LENGTH} caracteres.`);
  }
  const publicUrl = requireUrl(env, "CA_PUBLIC_URL", production ? undefined : `http://acesso.localhost:${port}`);
  const callbackUrl = requireUrl(env, "APP_CALLBACK_URL", production ? undefined : "http://localhost:5173/login/certificado");
  const authority = loadAuthority(env, read);
  if (production && !authority) {
    throw new Error(`Em produção a CA dos Dispositivos é obrigatória. Defina: ${CA_VARS.join(", ")}.`);
  }
  const base = { port, sharedSecret, publicUrl, callbackUrl, authority };

  const source = env.CA_CERT_SOURCE || (production ? undefined : "mock");
  if (source === undefined) {
    throw new Error("Em produção defina CA_CERT_SOURCE=header (o proxy que termina o TLS repassa o certificado do cliente).");
  }
  if (source === "header") {
    // O segredo é a única trava contra um header forjado, então é obrigatório em qualquer ambiente.
    const proxySecret = env.CA_PROXY_SECRET;
    if (!proxySecret) throw new Error("Com CA_CERT_SOURCE=header defina CA_PROXY_SECRET (o segredo que o proxy acrescenta, mínimo 32 caracteres).");
    if (proxySecret.length < MIN_SHARED_SECRET_LENGTH) {
      throw new Error(`CA_PROXY_SECRET precisa ter ao menos ${MIN_SHARED_SECRET_LENGTH} caracteres.`);
    }
    return {
      ...base,
      source: "header",
      proxy: {
        secret: proxySecret,
        ...(env.CA_CERT_HEADER ? { certificateHeader: env.CA_CERT_HEADER } : {}),
        ...(env.CA_PROXY_SECRET_HEADER ? { secretHeader: env.CA_PROXY_SECRET_HEADER } : {}),
      },
    };
  }
  if (source === "mock") {
    // Simular o certificado em produção deixaria entrar qualquer um: a CA nem sobe.
    if (production) throw new Error("CA_CERT_SOURCE=mock não existe em produção: use header.");
    return { ...base, source: "mock", mock: { deviceName: env.CA_MOCK_DEVICE || undefined } };
  }
  throw new Error(`CA_CERT_SOURCE inválido ("${source}"): use "header" ou "mock".`);
}

/** Escolhe o leitor do certificado de cliente de acordo com a fonte configurada. */
export function certificateReader(config: CaConfig, deviceStore: DeviceStore): (c: Context) => string | undefined | Promise<string | undefined> {
  if (config.source === "header" && config.proxy) return createForwardedCertificateReader(config.proxy);
  return createMockCertificateReader({ deviceStore, deviceName: config.mock?.deviceName });
}
