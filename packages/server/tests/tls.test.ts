import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { request, type RequestOptions } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createPlatformApp } from "../src/index.js";
import { DeviceCertificateAuthority } from "../src/iam/device-certificate-authority.js";
import { MemoryDeviceStore } from "../src/iam/device-store.js";
import { createCaFiles } from "../src/cli/create-ca.js";
import { createClientCertificateReader, loadServerSecurity, serveSecure, watchServerCertificate } from "../src/boot/tls.js";
import { createSeededUserStore, TEST_PASSWORD } from "./helpers/fixtures.js";

const dir = mkdtempSync(join(tmpdir(), "celestia-tls-"));
const openssl = (args: string[]) => execFileSync("openssl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** Certificado público do site (autoassinado, só para o teste), independente da CA dos Dispositivos. */
function makeSiteCertificate(name: string, cn: string): { certFile: string; keyFile: string } {
  const certFile = join(dir, `${name}.crt`);
  const keyFile = join(dir, `${name}.key`);
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyFile, "-out", certFile, "-days", "2", "-subj", `/CN=${cn}`, "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"]);
  return { certFile, keyFile };
}

const caFiles = { certFile: join(dir, "ca.crt"), keyFile: join(dir, "ca.key") };
let site: { certFile: string; keyFile: string };
beforeAll(async () => {
  site = makeSiteCertificate("site", "localhost");
  await createCaFiles({ ...caFiles, commonName: "Celestia CA (teste)" });
});

describe("configuração de TLS e da CA (falha fechado)", () => {
  const files = { TLS_CERT_FILE: "a.crt", TLS_KEY_FILE: "a.key", DEVICE_CA_CERT_FILE: "ca.crt", DEVICE_CA_KEY_FILE: "ca.key" };
  const read = (file: string) => Buffer.from(`conteudo de ${file}`);

  it("em produção exige o certificado do site e a CA, e nomeia o que falta", () => {
    expect(() => loadServerSecurity({ NODE_ENV: "production" }, read)).toThrow(/TLS_CERT_FILE.*TLS_KEY_FILE.*DEVICE_CA_CERT_FILE.*DEVICE_CA_KEY_FILE/s);
    expect(() => loadServerSecurity({ NODE_ENV: "production", ...files, DEVICE_CA_KEY_FILE: undefined }, read)).toThrow(/DEVICE_CA_KEY_FILE/);
    expect(loadServerSecurity({ NODE_ENV: "production", ...files }, read)?.tls).toBeDefined();
  });

  it("fora de produção, sem nada configurado, segue em HTTP puro", () => {
    expect(loadServerSecurity({ NODE_ENV: "development" }, read)).toEqual({ tls: undefined, ca: undefined });
  });

  it("fora de produção, configuração pela metade é erro, não HTTP silencioso", () => {
    expect(() => loadServerSecurity({ TLS_CERT_FILE: "a.crt" }, read)).toThrow(/TLS_KEY_FILE/);
    expect(() => loadServerSecurity({ DEVICE_CA_CERT_FILE: "ca.crt" }, read)).toThrow(/DEVICE_CA_KEY_FILE/);
    expect(() => loadServerSecurity({ TLS_KEY_FILE: "a.key", DEVICE_CA_CERT_FILE: "ca.crt", DEVICE_CA_KEY_FILE: "ca.key" }, read)).toThrow(/TLS_CERT_FILE/);
  });

  it("recusa o TLS sem a CA dos Dispositivos, antes de qualquer outro trabalho", () => {
    expect(() => loadServerSecurity({ TLS_CERT_FILE: "a.crt", TLS_KEY_FILE: "a.key" }, read)).toThrow(/DEVICE_CA_CERT_FILE.*DEVICE_CA_KEY_FILE/s);
  });

  it("devolve os caminhos do certificado do site, para a recarga", () => {
    const security = loadServerSecurity({ NODE_ENV: "production", ...files }, read);
    expect(security.tls).toMatchObject({ certFile: "a.crt", keyFile: "a.key" });
  });

  it("recusa arquivo que não existe, dizendo qual", () => {
    const missing = (file: string): Buffer => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT", path: file });
    };
    expect(() => loadServerSecurity({ NODE_ENV: "production", ...files }, missing)).toThrow(/a\.crt/);
  });
});

describe("create-ca", () => {
  it("grava o certificado e a chave da CA, a chave só para o dono, e não sobrescreve", async () => {
    expect(existsSync(caFiles.certFile)).toBe(true);
    expect(statSync(caFiles.keyFile).mode & 0o777).toBe(0o600);
    expect(readFileSync(caFiles.keyFile, "utf8")).toContain("BEGIN PRIVATE KEY");
    expect(openssl(["x509", "-in", caFiles.certFile, "-noout", "-subject"])).toContain("Celestia CA (teste)");

    await expect(createCaFiles({ ...caFiles, commonName: "Outra" })).rejects.toThrow(/já existe/);
    expect(openssl(["x509", "-in", caFiles.certFile, "-noout", "-subject"])).toContain("Celestia CA (teste)");
  });

  it("a CA gravada emite Dispositivos", async () => {
    const ca = new DeviceCertificateAuthority({
      certificatePem: readFileSync(caFiles.certFile, "utf8"),
      privateKeyPem: readFileSync(caFiles.keyFile, "utf8"),
    });
    expect((await ca.issue({ name: "Caixa" })).fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

interface Reply {
  status: number;
  body: string;
}

function call(port: number, options: RequestOptions, body?: object): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, servername: "localhost", ...options }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

describe("mTLS num servidor HTTPS real", () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });

  async function boot() {
    const userStore = createSeededUserStore();
    await userStore.createRole({ id: "role_a", name: "A", description: "d", permissions: [] });
    await userStore.createUser({ fullname: "Com Cert", username: "com.cert", password: TEST_PASSWORD, roleId: "role_a", allowWithoutCertificate: false });
    const ca = new DeviceCertificateAuthority({
      certificatePem: readFileSync(caFiles.certFile, "utf8"),
      privateKeyPem: readFileSync(caFiles.keyFile, "utf8"),
    });
    const deviceStore = new MemoryDeviceStore();
    const issued = await ca.issue({ name: "Caixa 1" });
    const device = await deviceStore.create({ name: "Caixa 1", fingerprint: issued.fingerprint, serial: issued.serial, notAfter: issued.notAfter.toISOString() });
    const app = createPlatformApp({ userStore, deviceStore, clientCertificateFingerprint: createClientCertificateReader() });
    const security = loadServerSecurity({ TLS_CERT_FILE: site.certFile, TLS_KEY_FILE: site.keyFile, DEVICE_CA_CERT_FILE: caFiles.certFile, DEVICE_CA_KEY_FILE: caFiles.keyFile });
    const server = serveSecure(app.fetch, { port: 0, tls: security.tls!, deviceCaCertificate: security.ca!.certificatePem });
    servers.push(server);
    await new Promise((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    const login = (tls: RequestOptions = {}) =>
      call(port, { method: "POST", path: "/api/auth/login", headers: { "Content-Type": "application/json" }, ca: readFileSync(site.certFile), ...tls }, { username: "com.cert", password: TEST_PASSWORD });
    return { issued, device, deviceStore, login, ca };
  }

  it("entra com o .pfx de um Dispositivo ativo", async () => {
    const { issued, login } = await boot();
    const res = await login({ pfx: Buffer.from(issued.pfx), passphrase: issued.password });
    expect(res.status).toBe(200);
  });

  it("nega quem conecta sem certificado, sem derrubar a conexão", async () => {
    const { login } = await boot();
    const res = await login();
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toContain("Dispositivo homologado");
  });

  it("nega o certificado de outra CA", async () => {
    const { login } = await boot();
    const other = await DeviceCertificateAuthority.create({ commonName: "Outra CA" });
    const intruder = await new DeviceCertificateAuthority(other).issue({ name: "Intruso" });
    const res = await login({ pfx: Buffer.from(intruder.pfx), passphrase: intruder.password });
    expect(res.status).toBe(403);
  });

  it("nega o certificado de um Dispositivo revogado", async () => {
    const { issued, device, deviceStore, login } = await boot();
    await deviceStore.revoke(device.id);
    const res = await login({ pfx: Buffer.from(issued.pfx), passphrase: issued.password });
    expect(res.status).toBe(403);
  });

  it("um header X-Client-Cert-Fingerprint vindo de fora não vale como certificado", async () => {
    const { issued, login } = await boot();
    const res = await login({ headers: { "Content-Type": "application/json", "X-Client-Cert-Fingerprint": issued.fingerprint } });
    expect(res.status).toBe(403);
  });
});

describe("recarga do certificado do site", () => {
  it("serve o certificado novo sem reiniciar quando os arquivos mudam", async () => {
    const first = makeSiteCertificate("reload", "localhost");
    const security = loadServerSecurity({ TLS_CERT_FILE: first.certFile, TLS_KEY_FILE: first.keyFile, DEVICE_CA_CERT_FILE: caFiles.certFile, DEVICE_CA_KEY_FILE: caFiles.keyFile });
    const app = createPlatformApp({ userStore: createSeededUserStore() });
    const server = serveSecure(app.fetch, { port: 0, tls: security.tls!, deviceCaCertificate: security.ca!.certificatePem });
    await new Promise((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    const stop = watchServerCertificate(server, { certFile: first.certFile, keyFile: first.keyFile, intervalMs: 50 });
    const fingerprintServed = () =>
      new Promise<string>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port, servername: "localhost", path: "/", rejectUnauthorized: false, agent: false }, (res) => {
          res.resume();
          resolve((res.socket as import("node:tls").TLSSocket).getPeerCertificate().fingerprint256);
        });
        req.on("error", reject);
        req.end();
      });

    try {
      const before = await fingerprintServed();
      const renewed = makeSiteCertificate("renewed", "localhost");
      writeFileSync(first.keyFile, readFileSync(renewed.keyFile));
      writeFileSync(first.certFile, readFileSync(renewed.certFile));

      await expect.poll(fingerprintServed, { timeout: 3000, interval: 100 }).not.toBe(before);
    } finally {
      stop();
      server.close();
    }
  });
});
