import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { DeviceCertificateAuthority } from "../src/authority.js";
import { createForwardedCertificateReader } from "../src/forwarded-certificate.js";

const SECRET = "segredo-do-proxy-com-mais-de-32-caracteres";

let issued: Awaited<ReturnType<DeviceCertificateAuthority["issue"]>>;
/** Corpo do certificado em base64, como o Traefik o coloca no header (sem as linhas BEGIN/END). */
let certBody: string;
let otherBody: string;

function bodyOf(pfx: Uint8Array, password: string): string {
  const dir = mkdtempSync(join(tmpdir(), "celestia-fwd-"));
  const pfxPath = join(dir, "d.pfx");
  writeFileSync(pfxPath, pfx);
  const pem = execFileSync("openssl", ["pkcs12", "-in", pfxPath, "-passin", `pass:${password}`, "-nokeys", "-clcerts"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return pem.replace(/[\s\S]*-----BEGIN CERTIFICATE-----/, "").replace(/-----END CERTIFICATE-----[\s\S]*/, "").replace(/\s+/g, "");
}

beforeAll(async () => {
  const ca = new DeviceCertificateAuthority(await DeviceCertificateAuthority.create({ commonName: "Celestia CA (teste)" }));
  issued = await ca.issue({ name: "Caixa 1" });
  certBody = bodyOf(issued.pfx, issued.password);
  const other = await ca.issue({ name: "Caixa 2" });
  otherBody = bodyOf(other.pfx, other.password);
});

/** Lê o fingerprint por uma requisição de verdade, para o `Context` ser o do Hono. */
async function read(headers: Record<string, string>, options: Parameters<typeof createForwardedCertificateReader>[0] = { secret: SECRET }) {
  const reader = createForwardedCertificateReader(options);
  const app = new Hono();
  app.get("/", (c) => c.json({ fingerprint: reader(c) ?? null }));
  return ((await (await app.request("/", { headers })).json()) as { fingerprint: string | null }).fingerprint;
}

const proxy = { "x-celestia-proxy-secret": SECRET };

describe("certificado repassado pelo proxy (header)", () => {
  it("lê o fingerprint do certificado, igual ao que o Celestia grava na emissão", async () => {
    expect(await read({ ...proxy, "x-forwarded-tls-client-cert": certBody })).toBe(issued.fingerprint);
  });

  it("aceita o valor codificado como URL, que é como o Traefik envia", async () => {
    expect(await read({ ...proxy, "x-forwarded-tls-client-cert": encodeURIComponent(certBody) })).toBe(issued.fingerprint);
  });

  it("numa cadeia separada por vírgula, usa o primeiro certificado", async () => {
    expect(await read({ ...proxy, "x-forwarded-tls-client-cert": `${certBody},${otherBody}` })).toBe(issued.fingerprint);
  });

  it("ignora o certificado quando falta o segredo do proxy ou ele não confere", async () => {
    expect(await read({ "x-forwarded-tls-client-cert": certBody })).toBeNull();
    expect(await read({ "x-celestia-proxy-secret": "outro-segredo", "x-forwarded-tls-client-cert": certBody })).toBeNull();
    expect(await read({ "x-celestia-proxy-secret": SECRET.slice(0, -1), "x-forwarded-tls-client-cert": certBody })).toBeNull();
  });

  it("devolve nada, sem lançar erro, quando o header falta ou não é um certificado", async () => {
    expect(await read({ ...proxy })).toBeNull();
    expect(await read({ ...proxy, "x-forwarded-tls-client-cert": "FORJADO" })).toBeNull();
    expect(await read({ ...proxy, "x-forwarded-tls-client-cert": "" })).toBeNull();
  });

  it("aceita outros nomes de header, para outro proxy", async () => {
    const options = { secret: SECRET, certificateHeader: "x-ssl-client-cert", secretHeader: "x-edge-secret" };
    expect(await read({ "x-edge-secret": SECRET, "x-ssl-client-cert": certBody }, options)).toBe(issued.fingerprint);
    expect(await read({ ...proxy, "x-forwarded-tls-client-cert": certBody }, options)).toBeNull();
  });

  it("recusa um segredo curto demais, porque ele é a única trava contra um header forjado", () => {
    expect(() => createForwardedCertificateReader({ secret: "curto" })).toThrow(/32/);
  });
});
