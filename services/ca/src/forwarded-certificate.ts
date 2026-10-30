import { X509Certificate, createHash, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

export const MIN_PROXY_SECRET_LENGTH = 32;

export interface ForwardedCertificateOptions {
  /** Segredo que o proxy acrescenta a toda requisição; sem ele, o certificado repassado é ignorado. */
  secret: string;
  /** Header com o certificado do cliente. Padrão: o do `passTLSClientCert` do Traefik. */
  certificateHeader?: string;
  /** Header com o segredo do proxy. */
  secretHeader?: string;
}

const sameSecret = (received: string | undefined, expected: string): boolean => {
  if (received === undefined) return false;
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
};

/**
 * Lê o certificado de cliente que um proxy (Traefik) já validou contra a CA dos Dispositivos e repassou em um
 * header, e devolve o fingerprint (SHA-256 do DER, hexadecimal). O header só vale junto do segredo do proxy: o app
 * fica atrás do proxy, mas o segredo é a trava que impede um header forjado de se passar por um Dispositivo.
 * O valor chega em base64 do DER, possivelmente codificado como URL e, numa cadeia, separado por vírgula.
 */
export function createForwardedCertificateReader({
  secret,
  certificateHeader = "x-forwarded-tls-client-cert",
  secretHeader = "x-celestia-proxy-secret",
}: ForwardedCertificateOptions): (c: Context) => string | undefined {
  if (secret.length < MIN_PROXY_SECRET_LENGTH) {
    throw new Error(`O segredo do proxy precisa ter ao menos ${MIN_PROXY_SECRET_LENGTH} caracteres.`);
  }
  return (c) => {
    if (!sameSecret(c.req.header(secretHeader), secret)) return undefined;
    const value = c.req.header(certificateHeader);
    if (!value) return undefined;
    try {
      const leaf = decodeURIComponent(value).split(",")[0]!.trim();
      const der = Buffer.from(leaf, "base64");
      // Garante que é um certificado de verdade antes de confiar no hash.
      const cert = new X509Certificate(der);
      return createHash("sha256").update(cert.raw).digest("hex");
    } catch {
      return undefined;
    }
  };
}
