import { describe, it, expect } from "vitest";
import { loadCertificateAuthorityClient } from "../src/boot/certificate-authority.js";
import { CertificateAuthorityUnavailableError, HttpCertificateAuthorityClient } from "../src/iam/certificate-authority-client.js";

const secret = "chave-em-comum-com-mais-de-32-caracteres";

describe("configuração do cliente da autoridade certificadora", () => {
  it("exige a chave em comum, com ao menos 32 caracteres, em qualquer ambiente", () => {
    expect(() => loadCertificateAuthorityClient({})).toThrow(/CA_SHARED_SECRET/);
    expect(() => loadCertificateAuthorityClient({ CA_SHARED_SECRET: "curta" })).toThrow(/32/);
  });

  it("em produção exige o endereço da autoridade, e recusa um que não é URL", () => {
    expect(() => loadCertificateAuthorityClient({ NODE_ENV: "production", CA_SHARED_SECRET: secret })).toThrow(/CA_URL/);
    expect(() => loadCertificateAuthorityClient({ NODE_ENV: "production", CA_SHARED_SECRET: secret, CA_URL: "não é url" })).toThrow(/CA_URL/);
    expect(loadCertificateAuthorityClient({ NODE_ENV: "production", CA_SHARED_SECRET: secret, CA_URL: "http://ca:3001" })).toBeInstanceOf(HttpCertificateAuthorityClient);
  });

  it("em desenvolvimento usa o endereço local por padrão", () => {
    expect(loadCertificateAuthorityClient({ CA_SHARED_SECRET: secret })).toBeInstanceOf(HttpCertificateAuthorityClient);
  });
});

describe("HttpCertificateAuthorityClient", () => {
  const client = (respond: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
    new HttpCertificateAuthorityClient({ baseUrl: "http://ca.test/", secret, fetch: async (input, init) => respond(String(input), init) });

  it("envia a chave em comum como Bearer em toda chamada", async () => {
    let seen: Headers | undefined;
    await client((url, init) => {
      seen = new Headers(init?.headers);
      expect(url).toBe("http://ca.test/devices");
      return Response.json([]);
    }).listDevices();
    expect(seen?.get("authorization")).toBe(`Bearer ${secret}`);
  });

  it("trata falha de rede, 5xx e chave recusada (401) como autoridade indisponível", async () => {
    await expect(client(() => Promise.reject(new TypeError("fetch failed"))).listDevices()).rejects.toBeInstanceOf(CertificateAuthorityUnavailableError);
    await expect(client(() => new Response("x", { status: 502 })).listDevices()).rejects.toBeInstanceOf(CertificateAuthorityUnavailableError);
    await expect(client(() => new Response("x", { status: 401 })).getDevice("d1")).rejects.toBeInstanceOf(CertificateAuthorityUnavailableError);
  });

  it("devolve a mensagem da autoridade quando ela responde 503", async () => {
    const res = () => Response.json({ error: "A autoridade certificadora não tem a CA configurada." }, { status: 503 });
    await expect(client(res).issueDevice({ name: "Caixa" })).rejects.toThrow("A autoridade certificadora não tem a CA configurada.");
  });

  it("devolve null para Dispositivo inexistente", async () => {
    expect(await client(() => Response.json({ error: "x" }, { status: 404 })).getDevice("nao-existe")).toBeNull();
  });
});
