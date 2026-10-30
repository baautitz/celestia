import { createHash } from "node:crypto";
import { readFileSync, unwatchFile, watchFile } from "node:fs";
import type { Context } from "hono";
import { serve } from "@hono/node-server";
import { createServer, Server, type ServerOptions } from "node:https";
import type { Server as HttpServer } from "node:http";
import type { TLSSocket } from "node:tls";
import type { CertificateAuthorityMaterial } from "../iam/device-certificate-authority.js";
import type { DeviceStore } from "../iam/device-store.js";
import { MIN_PROXY_SECRET_LENGTH, createForwardedCertificateReader } from "./forwarded-certificate.js";
import { createMockCertificateReader } from "./mock-certificate.js";

export interface ServerSecurity {
  /**
   * De onde vem o certificado de cliente: `socket` (o Node termina o TLS e valida a cadeia) ou `header` (um proxy,
   * como o Traefik, termina o TLS, valida a cadeia e repassa o certificado).
   */
  source: "socket" | "header" | "mock";
  /** Certificado público do site, apresentado ao navegador. Só na fonte `socket`. */
  tls?: { key: Buffer; cert: Buffer; certFile: string; keyFile: string };
  /** CA que emite (e, na fonte `socket`, valida) os certificados dos Dispositivos. */
  ca?: CertificateAuthorityMaterial;
  /** Só na fonte `mock` (desenvolvimento): o nome do Dispositivo a simular. */
  mock?: { deviceName: string | undefined };
  /** Só na fonte `header`: o segredo que o proxy acrescenta e os nomes dos headers. */
  proxy?: { secret: string; certificateHeader?: string; secretHeader?: string };
}

type Env = Record<string, string | undefined>;
type ReadFile = (path: string) => Buffer;

const TLS_VARS = ["TLS_CERT_FILE", "TLS_KEY_FILE"] as const;
const CA_VARS = ["DEVICE_CA_CERT_FILE", "DEVICE_CA_KEY_FILE"] as const;

function readOrExplain(file: string, read: ReadFile): Buffer {
  try {
    return read(file);
  } catch (err: unknown) {
    throw new Error(`Não foi possível ler o arquivo "${file}": ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

function readCa(env: Env, read: ReadFile): CertificateAuthorityMaterial {
  return {
    certificatePem: readOrExplain(env.DEVICE_CA_CERT_FILE!, read).toString("utf8"),
    privateKeyPem: readOrExplain(env.DEVICE_CA_KEY_FILE!, read).toString("utf8"),
  };
}

/** Agrupa as variáveis que só fazem sentido juntas: tudo, nada, ou erro nomeando o que falta. */
function groupPresent(env: Env, vars: readonly string[]): boolean {
  const absent = vars.filter((name) => !env[name]);
  if (absent.length === vars.length) return false;
  if (absent.length > 0) throw new Error(`Configuração incompleta: defina também ${absent.join(", ")}.`);
  return true;
}

/** Fonte `header`: o proxy termina o TLS. O Node não tem certificado de site, mas precisa da CA e do segredo do proxy. */
function loadHeaderSource(env: Env, read: ReadFile): ServerSecurity {
  const production = env.NODE_ENV === "production";
  const tlsSet = TLS_VARS.filter((name) => env[name]);
  if (tlsSet.length > 0) {
    throw new Error(`${tlsSet.join(", ")} não se aplica com CLIENT_CERT_SOURCE=header: quem termina o TLS é o proxy, não o Node.`);
  }
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
    ca: groupPresent(env, CA_VARS) ? readCa(env, read) : undefined,
    proxy: {
      secret,
      ...(env.CLIENT_CERT_HEADER ? { certificateHeader: env.CLIENT_CERT_HEADER } : {}),
      ...(env.PROXY_SECRET_HEADER ? { secretHeader: env.PROXY_SECRET_HEADER } : {}),
    },
  };
}

/**
 * Lê a segurança do servidor. Em produção a configuração é obrigatória, para a falta dela nunca virar "sem
 * exigência de certificado". Fora dela, cada grupo é opcional, mas um grupo pela metade é erro.
 *
 * - `CLIENT_CERT_SOURCE=socket` (padrão): o Node termina o TLS; precisa do certificado do site e da CA. Sem TLS
 *   (só fora de produção), responde em HTTP puro e ninguém apresenta certificado.
 * - `CLIENT_CERT_SOURCE=header`: um proxy termina o TLS e repassa o certificado; precisa do segredo do proxy.
 */
export function loadServerSecurity(env: Env = process.env, read: ReadFile = readFileSync): ServerSecurity {
  const source = env.CLIENT_CERT_SOURCE || "socket";
  if (source === "header") return loadHeaderSource(env, read);
  if (source === "mock") {
    // Simular o certificado em produção deixaria entrar qualquer um: o servidor nem sobe.
    if (env.NODE_ENV === "production") throw new Error("CLIENT_CERT_SOURCE=mock não existe em produção: use socket ou header.");
    return { source: "mock", mock: { deviceName: env.DEV_CLIENT_CERT_DEVICE || undefined } };
  }
  if (source !== "socket") throw new Error(`CLIENT_CERT_SOURCE inválido ("${source}"): use "socket", "header" ou "mock".`);

  const production = env.NODE_ENV === "production";
  const missing = [...TLS_VARS, ...CA_VARS].filter((name) => !env[name]);
  if (production && missing.length > 0) {
    throw new Error(`Em produção o servidor exige TLS e a CA dos Dispositivos. Defina: ${missing.join(", ")}.`);
  }

  const hasTls = groupPresent(env, TLS_VARS);
  const hasCa = groupPresent(env, CA_VARS);
  // O TLS só serve para pedir o certificado de cliente, que só vale contra a CA: sem ela falha já aqui, não no meio do boot.
  if (hasTls && !hasCa) throw new Error(`O TLS exige a CA dos Dispositivos: defina também ${CA_VARS.join(", ")}.`);
  return {
    source: "socket",
    tls: hasTls
      ? {
          cert: readOrExplain(env.TLS_CERT_FILE!, read),
          key: readOrExplain(env.TLS_KEY_FILE!, read),
          certFile: env.TLS_CERT_FILE!,
          keyFile: env.TLS_KEY_FILE!,
        }
      : undefined,
    ca: hasCa ? readCa(env, read) : undefined,
  };
}

/**
 * Lê o fingerprint (SHA-256 do DER, hexadecimal) do certificado de cliente da conexão TLS. Só vale quando o
 * Node validou a cadeia contra a CA dos Dispositivos (`authorized`); nenhum header da requisição é consultado.
 */
export function createClientCertificateReader(): (c: Context) => string | undefined {
  return (c) => {
    const socket = (c.env as { incoming?: { socket?: TLSSocket } } | undefined)?.incoming?.socket;
    if (!socket || !("authorized" in socket) || !socket.authorized) return undefined;
    const cert = socket.getPeerCertificate();
    return cert?.raw ? createHash("sha256").update(cert.raw).digest("hex") : undefined;
  };
}

export interface ServeSecureOptions {
  port: number;
  tls: { key: Buffer; cert: Buffer };
  deviceCaCertificate: string;
}

/**
 * Sobe o HTTPS pedindo o certificado de cliente sem recusar quem não tem: `rejectUnauthorized: false` deixa a
 * decisão para a aplicação, que nega só quem exige certificado. Assim quem não tem certificado instalado não vê
 * seletor no navegador.
 */
export function serveSecure(fetch: (request: Request, env?: unknown) => Response | Promise<Response>, options: ServeSecureOptions): Server {
  const serverOptions: ServerOptions = {
    key: options.tls.key,
    cert: options.tls.cert,
    ca: options.deviceCaCertificate,
    requestCert: true,
    rejectUnauthorized: false,
  };
  const server = serve({ fetch, port: options.port, createServer, serverOptions });
  // Com `createServer` do https, o Hono devolve o servidor HTTPS.
  if (!(server instanceof Server)) throw new Error("O servidor HTTPS não foi criado.");
  return server;
}

export interface WatchServerCertificateOptions {
  certFile: string;
  keyFile: string;
  intervalMs?: number;
}

/** Recarrega o certificado do site quando os arquivos mudam (renovação do Let's Encrypt), sem reiniciar. */
export function watchServerCertificate(server: HttpServer | Server, { certFile, keyFile, intervalMs = 60_000 }: WatchServerCertificateOptions): () => void {
  const reload = () => {
    try {
      (server as Server).setSecureContext({ key: readFileSync(keyFile), cert: readFileSync(certFile) });
    } catch (err: unknown) {
      // Mantém o certificado em uso: um arquivo ilegível durante a troca não derruba o servidor.
      console.error(`Não foi possível recarregar o certificado do site: ${err instanceof Error ? err.message : err}`);
    }
  };
  watchFile(certFile, { interval: intervalMs }, reload);
  watchFile(keyFile, { interval: intervalMs }, reload);
  return () => {
    unwatchFile(certFile, reload);
    unwatchFile(keyFile, reload);
  };
}

/** Escolhe o leitor do certificado de cliente de acordo com a fonte configurada. */
export function clientCertificateReader(security: ServerSecurity, deviceStore: DeviceStore): (c: Context) => string | undefined | Promise<string | undefined> {
  if (security.source === "header" && security.proxy) return createForwardedCertificateReader(security.proxy);
  if (security.source === "mock") return createMockCertificateReader({ deviceStore, deviceName: security.mock?.deviceName });
  return createClientCertificateReader();
}
