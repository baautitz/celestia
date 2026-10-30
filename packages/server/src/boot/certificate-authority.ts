import { HttpCertificateAuthorityClient, MIN_CA_SHARED_SECRET_LENGTH } from "../iam/certificate-authority-client.js";

type Env = Record<string, string | undefined>;

const DEV_CA_URL = "http://localhost:3001";

/**
 * Cliente da autoridade certificadora (`services/ca`), que fala com a CA usando a chave em comum.
 * A chave é obrigatória em qualquer ambiente e o endereço da CA, em produção, para a falta de configuração nunca
 * virar "sem exigência de certificado".
 */
export function loadCertificateAuthorityClient(env: Env = process.env): HttpCertificateAuthorityClient {
  const secret = env.CA_SHARED_SECRET;
  if (!secret) throw new Error("Defina CA_SHARED_SECRET (a chave em comum com a autoridade certificadora, mínimo 32 caracteres).");
  if (secret.length < MIN_CA_SHARED_SECRET_LENGTH) {
    throw new Error(`CA_SHARED_SECRET precisa ter ao menos ${MIN_CA_SHARED_SECRET_LENGTH} caracteres.`);
  }
  const production = env.NODE_ENV === "production";
  const baseUrl = env.CA_URL || (production ? undefined : DEV_CA_URL);
  if (!baseUrl) throw new Error("Em produção defina CA_URL (o endereço interno da autoridade certificadora).");
  try {
    new URL(baseUrl);
  } catch {
    throw new Error(`CA_URL não é uma URL válida ("${baseUrl}").`);
  }
  return new HttpCertificateAuthorityClient({ baseUrl, secret });
}
