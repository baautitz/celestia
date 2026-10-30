import { describe, it, expect } from "vitest";
import { loadCaConfig } from "../src/config.js";

const read = (file: string) => Buffer.from(`conteudo de ${file}`);
const shared = "chave-em-comum-com-mais-de-32-caracteres";
const proxySecret = "segredo-do-proxy-com-mais-de-32-caracteres";
const ca = { DEVICE_CA_CERT_FILE: "ca.crt", DEVICE_CA_KEY_FILE: "ca.key" };
const urls = { CA_PUBLIC_URL: "https://acesso.exemplo.com", APP_CALLBACK_URL: "https://app.exemplo.com/login/certificado" };
const production = { NODE_ENV: "production", CA_SHARED_SECRET: shared, CA_CERT_SOURCE: "header", CA_PROXY_SECRET: proxySecret, ...urls, ...ca };

describe("chave em comum", () => {
  it("é obrigatória em qualquer ambiente, com ao menos 32 caracteres", () => {
    expect(() => loadCaConfig({}, read)).toThrow(/CA_SHARED_SECRET/);
    expect(() => loadCaConfig({ CA_SHARED_SECRET: "curta" }, read)).toThrow(/32/);
  });
});

describe("em produção (falha fechado)", () => {
  it("aceita a configuração completa", () => {
    const config = loadCaConfig(production, read);
    expect(config).toMatchObject({ source: "header", publicUrl: urls.CA_PUBLIC_URL, callbackUrl: urls.APP_CALLBACK_URL, proxy: { secret: proxySecret } });
    expect(config.authority).toEqual({ certificatePem: "conteudo de ca.crt", privateKeyPem: "conteudo de ca.key" });
  });

  it("exige CA_CERT_SOURCE=header", () => {
    expect(() => loadCaConfig({ ...production, CA_CERT_SOURCE: undefined }, read)).toThrow(/CA_CERT_SOURCE=header/);
    expect(() => loadCaConfig({ ...production, CA_CERT_SOURCE: "" }, read)).toThrow(/CA_CERT_SOURCE=header/);
  });

  it("recusa a simulação, que deixaria entrar qualquer um", () => {
    expect(() => loadCaConfig({ ...production, CA_CERT_SOURCE: "mock", CA_MOCK_DEVICE: "Caixa 1" }, read)).toThrow(/produção/);
  });

  it("exige os endereços e a CA dos Dispositivos, nomeando o que falta", () => {
    expect(() => loadCaConfig({ ...production, CA_PUBLIC_URL: undefined }, read)).toThrow(/CA_PUBLIC_URL/);
    expect(() => loadCaConfig({ ...production, APP_CALLBACK_URL: undefined }, read)).toThrow(/APP_CALLBACK_URL/);
    expect(() => loadCaConfig({ ...production, DEVICE_CA_CERT_FILE: undefined, DEVICE_CA_KEY_FILE: undefined }, read)).toThrow(/DEVICE_CA_CERT_FILE/);
    expect(() => loadCaConfig({ ...production, DEVICE_CA_KEY_FILE: undefined }, read)).toThrow(/DEVICE_CA_KEY_FILE/);
  });

  it("recusa endereço que não é uma URL", () => {
    expect(() => loadCaConfig({ ...production, APP_CALLBACK_URL: "não é url" }, read)).toThrow(/APP_CALLBACK_URL/);
  });

  it("recusa arquivo da CA que não existe, dizendo qual", () => {
    const missing = (file: string): Buffer => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT", path: file });
    };
    expect(() => loadCaConfig(production, missing)).toThrow(/ca\.crt/);
  });
});

describe("fonte header", () => {
  it("exige o segredo do proxy até fora de produção: sem ele o header seria aceito de qualquer um", () => {
    expect(() => loadCaConfig({ CA_SHARED_SECRET: shared, CA_CERT_SOURCE: "header" }, read)).toThrow(/CA_PROXY_SECRET/);
    expect(() => loadCaConfig({ CA_SHARED_SECRET: shared, CA_CERT_SOURCE: "header", CA_PROXY_SECRET: "curto" }, read)).toThrow(/32/);
  });

  it("fora de produção a CA é opcional, mas pela metade é erro", () => {
    const dev = { CA_SHARED_SECRET: shared, CA_CERT_SOURCE: "header", CA_PROXY_SECRET: proxySecret };
    expect(loadCaConfig(dev, read).authority).toBeUndefined();
    expect(() => loadCaConfig({ ...dev, DEVICE_CA_CERT_FILE: "ca.crt" }, read)).toThrow(/DEVICE_CA_KEY_FILE/);
  });

  it("repassa os nomes de header configurados", () => {
    const config = loadCaConfig({ ...production, CA_CERT_HEADER: "x-ssl-client-cert", CA_PROXY_SECRET_HEADER: "x-edge-secret" }, read);
    expect(config.proxy).toEqual({ secret: proxySecret, certificateHeader: "x-ssl-client-cert", secretHeader: "x-edge-secret" });
  });
});

describe("desenvolvimento", () => {
  const dev = { CA_SHARED_SECRET: shared };

  it("usa endereços locais por padrão", () => {
    expect(loadCaConfig(dev, read)).toMatchObject({ port: 3001, publicUrl: "http://localhost:3001", callbackUrl: "http://localhost:5173/login/certificado" });
  });

  it("a simulação liga com o nome do Dispositivo a simular", () => {
    expect(loadCaConfig({ ...dev, CA_CERT_SOURCE: "mock", CA_MOCK_DEVICE: "Caixa 1" }, read)).toMatchObject({ source: "mock", mock: { deviceName: "Caixa 1" } });
  });

  it("sem o nome, ou sem nenhuma fonte, ninguém apresenta certificado", () => {
    expect(loadCaConfig({ ...dev, CA_CERT_SOURCE: "mock" }, read)).toMatchObject({ source: "mock", mock: { deviceName: undefined } });
    expect(loadCaConfig(dev, read)).toMatchObject({ source: "mock", mock: { deviceName: undefined } });
  });

  it("recusa uma fonte desconhecida", () => {
    expect(() => loadCaConfig({ ...dev, CA_CERT_SOURCE: "cabeçalho" }, read)).toThrow(/"header" ou "mock"/);
    expect(() => loadCaConfig({ ...dev, CA_CERT_SOURCE: "socket" }, read)).toThrow(/"header" ou "mock"/);
  });
});
