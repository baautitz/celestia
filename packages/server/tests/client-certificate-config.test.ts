import { describe, it, expect } from "vitest";
import { loadServerSecurity } from "../src/boot/client-certificate.js";

const read = (file: string) => Buffer.from(`conteudo de ${file}`);
const secret = "segredo-do-proxy-com-mais-de-32-caracteres";
const ca = { DEVICE_CA_CERT_FILE: "ca.crt", DEVICE_CA_KEY_FILE: "ca.key" };
const header = { CLIENT_CERT_SOURCE: "header", PROXY_SHARED_SECRET: secret, ...ca };

describe("fonte do certificado em produção (falha fechado)", () => {
  it("exige CLIENT_CERT_SOURCE=header, e nomeia o que falta", () => {
    expect(() => loadServerSecurity({ NODE_ENV: "production" }, read)).toThrow(/CLIENT_CERT_SOURCE=header/);
    expect(() => loadServerSecurity({ NODE_ENV: "production", CLIENT_CERT_SOURCE: "" }, read)).toThrow(/CLIENT_CERT_SOURCE=header/);
  });

  it("recusa a simulação, que deixaria entrar qualquer um", () => {
    expect(() => loadServerSecurity({ NODE_ENV: "production", CLIENT_CERT_SOURCE: "mock", DEV_CLIENT_CERT_DEVICE: "Caixa 1" }, read)).toThrow(/produção/);
  });

  it("exige o segredo do proxy e a CA, e nomeia o que falta", () => {
    expect(() => loadServerSecurity({ NODE_ENV: "production", CLIENT_CERT_SOURCE: "header" }, read)).toThrow(/PROXY_SHARED_SECRET.*DEVICE_CA_CERT_FILE.*DEVICE_CA_KEY_FILE/s);
    expect(() => loadServerSecurity({ NODE_ENV: "production", ...header, DEVICE_CA_KEY_FILE: undefined }, read)).toThrow(/DEVICE_CA_KEY_FILE/);
    expect(() => loadServerSecurity({ NODE_ENV: "production", ...header, PROXY_SHARED_SECRET: undefined }, read)).toThrow(/PROXY_SHARED_SECRET/);
  });

  it("aceita a configuração completa", () => {
    const security = loadServerSecurity({ NODE_ENV: "production", ...header }, read);
    expect(security).toMatchObject({ source: "header", proxy: { secret } });
    expect(security.ca).toEqual({ certificatePem: "conteudo de ca.crt", privateKeyPem: "conteudo de ca.key" });
  });
});

describe("fonte header", () => {
  it("exige o segredo do proxy até fora de produção: sem ele o header seria aceito de qualquer um", () => {
    expect(() => loadServerSecurity({ CLIENT_CERT_SOURCE: "header" }, read)).toThrow(/PROXY_SHARED_SECRET/);
    expect(() => loadServerSecurity({ ...header, PROXY_SHARED_SECRET: "curto" }, read)).toThrow(/32/);
  });

  it("fora de produção a CA é opcional, mas pela metade é erro", () => {
    expect(loadServerSecurity({ CLIENT_CERT_SOURCE: "header", PROXY_SHARED_SECRET: secret }, read).ca).toBeUndefined();
    expect(() => loadServerSecurity({ CLIENT_CERT_SOURCE: "header", PROXY_SHARED_SECRET: secret, DEVICE_CA_CERT_FILE: "ca.crt" }, read)).toThrow(/DEVICE_CA_KEY_FILE/);
  });

  it("repassa os nomes de header configurados", () => {
    const security = loadServerSecurity({ ...header, CLIENT_CERT_HEADER: "x-ssl-client-cert", PROXY_SECRET_HEADER: "x-edge-secret" }, read);
    expect(security.proxy).toEqual({ secret, certificateHeader: "x-ssl-client-cert", secretHeader: "x-edge-secret" });
  });

  it("recusa arquivo da CA que não existe, dizendo qual", () => {
    const missing = (file: string): Buffer => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT", path: file });
    };
    expect(() => loadServerSecurity({ NODE_ENV: "production", ...header }, missing)).toThrow(/ca\.crt/);
  });
});

describe("desenvolvimento", () => {
  it("a simulação liga com o nome do Dispositivo a simular", () => {
    expect(loadServerSecurity({ CLIENT_CERT_SOURCE: "mock", DEV_CLIENT_CERT_DEVICE: "Caixa 1" }, read)).toMatchObject({ source: "mock", mock: { deviceName: "Caixa 1" } });
  });

  it("sem o nome, ou sem nenhuma configuração, ninguém apresenta certificado", () => {
    expect(loadServerSecurity({ CLIENT_CERT_SOURCE: "mock" }, read)).toMatchObject({ source: "mock", mock: { deviceName: undefined } });
    expect(loadServerSecurity({}, read)).toMatchObject({ source: "mock", mock: { deviceName: undefined } });
    expect(loadServerSecurity({ NODE_ENV: "development", CLIENT_CERT_SOURCE: "", DEV_CLIENT_CERT_DEVICE: "" }, read)).toMatchObject({ source: "mock" });
  });

  it("recusa uma fonte desconhecida, inclusive a antiga \"socket\"", () => {
    expect(() => loadServerSecurity({ CLIENT_CERT_SOURCE: "cabeçalho" }, read)).toThrow(/CLIENT_CERT_SOURCE/);
    expect(() => loadServerSecurity({ CLIENT_CERT_SOURCE: "socket" }, read)).toThrow(/"header" ou "mock"/);
  });
});
