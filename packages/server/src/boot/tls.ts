import { createHash } from "node:crypto";
import { readFileSync, unwatchFile, watchFile } from "node:fs";
import type { Context } from "hono";
import { serve } from "@hono/node-server";
import { createServer, Server, type ServerOptions } from "node:https";
import type { Server as HttpServer } from "node:http";
import type { TLSSocket } from "node:tls";
import type { CertificateAuthorityMaterial } from "../iam/device-certificate-authority.js";

export interface ServerSecurity {
  /** Certificado público do site, apresentado ao navegador. Independente da CA dos Dispositivos. */
  tls?: { key: Buffer; cert: Buffer };
  /** CA que emite e valida os certificados dos Dispositivos. */
  ca?: CertificateAuthorityMaterial;
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

/**
 * Lê o certificado do site e a CA dos Dispositivos. Em produção os dois são obrigatórios, para a falta de
 * configuração nunca virar "sem exigência de certificado". Fora dela, cada grupo é opcional, mas um grupo
 * pela metade é erro. Sem TLS, o servidor responde em HTTP puro e ninguém apresenta certificado.
 */
export function loadServerSecurity(env: Env = process.env, read: ReadFile = readFileSync): ServerSecurity {
  const production = env.NODE_ENV === "production";
  const missing = [...TLS_VARS, ...CA_VARS].filter((name) => !env[name]);

  const group = (vars: readonly string[]) => {
    const absent = vars.filter((name) => !env[name]);
    if (absent.length === vars.length) return false;
    if (absent.length > 0) throw new Error(`Configuração incompleta: defina também ${absent.join(", ")}.`);
    return true;
  };

  if (production && missing.length > 0) {
    throw new Error(`Em produção o servidor exige TLS e a CA dos Dispositivos. Defina: ${missing.join(", ")}.`);
  }

  const hasTls = group(TLS_VARS);
  const hasCa = group(CA_VARS);
  return {
    tls: hasTls ? { cert: readOrExplain(env.TLS_CERT_FILE!, read), key: readOrExplain(env.TLS_KEY_FILE!, read) } : undefined,
    ca: hasCa
      ? {
          certificatePem: readOrExplain(env.DEVICE_CA_CERT_FILE!, read).toString("utf8"),
          privateKeyPem: readOrExplain(env.DEVICE_CA_KEY_FILE!, read).toString("utf8"),
        }
      : undefined,
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
