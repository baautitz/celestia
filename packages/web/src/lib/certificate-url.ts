/**
 * Endereço da autoridade certificadora vindo do servidor, validado antes de o navegador ir até ele: só `https:`
 * (ou `http:` em desenvolvimento). Devolve `null` quando o valor não é uma URL absoluta aceitável.
 */
export function safeCertificateUrl(raw: string, allowInsecure: boolean = import.meta.env.DEV): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" || (allowInsecure && url.protocol === "http:")) return url.href;
    return null;
  } catch {
    return null;
  }
}
