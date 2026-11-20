import { describe, it, expect } from "vitest";
import { loadCertificateAuthorityClient } from "../src/boot/certificate-authority.js";
import { CertificateAuthorityUnavailableError, CertificateAuthorityValidationError, HttpCertificateAuthorityClient } from "../src/iam/certificate-authority-client.js";

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

  it("não trata status inesperado (3xx, 403, 404 e 409 fora do esperado) como sucesso", async () => {
    await expect(client(() => new Response(null, { status: 302 })).listDevices()).rejects.toBeInstanceOf(CertificateAuthorityUnavailableError);
    await expect(client(() => Response.json({}, { status: 403 })).listDevices()).rejects.toBeInstanceOf(CertificateAuthorityUnavailableError);
    await expect(client(() => Response.json({}, { status: 404 })).listDevices()).rejects.toBeInstanceOf(CertificateAuthorityUnavailableError);
    await expect(client(() => Response.json({}, { status: 409 })).issueDevice({ name: "Caixa" })).rejects.toBeInstanceOf(CertificateAuthorityUnavailableError);
    await expect(client(() => Response.json({}, { status: 404 })).createChallenge("u1")).rejects.toBeInstanceOf(CertificateAuthorityUnavailableError);
  });

  it("devolve o corpo da validação quando a autoridade responde 400", async () => {
    const body = { error: { issues: [{ path: ["name"], message: "Too small" }] } };
    const rejected = await client(() => Response.json(body, { status: 400 })).issueDevice({ name: "" }).catch((err: unknown) => err);
    expect(rejected).toBeInstanceOf(CertificateAuthorityValidationError);
    expect((rejected as CertificateAuthorityValidationError).body).toEqual(body);
    // 400 sem o contrato de validação é uma autoridade com defeito.
    await expect(client(() => Response.json({ x: 1 }, { status: 400 })).issueDevice({ name: "" })).rejects.toBeInstanceOf(CertificateAuthorityUnavailableError);
  });

  it("corpo ilegível numa resposta de sucesso vira autoridade indisponível", async () => {
    const broken = () => new Response("<html>not json</html>", { status: 200 });
    await expect(client(broken).listDevices()).rejects.toBeInstanceOf(CertificateAuthorityUnavailableError);
    await expect(client(broken).getDevice("d1")).rejects.toBeInstanceOf(CertificateAuthorityUnavailableError);
    await expect(client(broken).issueDevice({ name: "Caixa" })).rejects.toBeInstanceOf(CertificateAuthorityUnavailableError);
    await expect(client(broken).revokeDevice("d1")).rejects.toBeInstanceOf(CertificateAuthorityUnavailableError);
    await expect(client(broken).createChallenge("u1")).rejects.toBeInstanceOf(CertificateAuthorityUnavailableError);
    await expect(client(broken).exchangeChallenge({ challengeId: "c1" })).rejects.toBeInstanceOf(CertificateAuthorityUnavailableError);
  });

  it("a troca do desafio só concede com 2xx; 403 nega e qualquer outro status falha", async () => {
    const granted = { userId: "u1", deviceId: "d1", deviceName: "Caixa" };
    expect(await client(() => Response.json(granted)).exchangeChallenge({ challengeId: "c1" })).toEqual({ granted: true, ...granted });
    expect(await client(() => Response.json({ error: "device_required", userId: "u1" }, { status: 403 })).exchangeChallenge({ challengeId: "c1" })).toEqual({ granted: false, userId: "u1" });
    await expect(client(() => Response.json({}, { status: 404 })).exchangeChallenge({ challengeId: "c1" })).rejects.toBeInstanceOf(CertificateAuthorityUnavailableError);
  });
});
