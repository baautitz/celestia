import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceCertificateAuthority } from "../src/iam/device-certificate-authority.js";

const openssl = (args: string[]) => execFileSync("openssl", args, { encoding: "utf8" });

describe("DeviceCertificateAuthority", () => {
  let dir: string;
  let ca: DeviceCertificateAuthority;
  let caPem: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "celestia-ca-"));
    const created = await DeviceCertificateAuthority.create({ commonName: "Celestia CA (teste)" });
    caPem = created.certificatePem;
    ca = new DeviceCertificateAuthority(created);
    return () => rmSync(dir, { recursive: true, force: true });
  });

  it("emite um .pfx que abre com a senha devolvida e leva um certificado assinado pela CA", async () => {
    const issued = await ca.issue({ name: "Caixa 1" });

    const pfxPath = join(dir, "caixa1.pfx");
    const caPath = join(dir, "ca.pem");
    const certPath = join(dir, "caixa1.pem");
    writeFileSync(pfxPath, issued.pfx);
    writeFileSync(caPath, caPem);

    const cert = openssl(["pkcs12", "-in", pfxPath, "-passin", `pass:${issued.password}`, "-nokeys", "-clcerts"]);
    writeFileSync(certPath, cert);

    expect(openssl(["verify", "-CAfile", caPath, certPath])).toContain("OK");
    expect(openssl(["x509", "-in", certPath, "-noout", "-subject"])).toContain("Caixa 1");
    expect(openssl(["x509", "-in", certPath, "-noout", "-fingerprint", "-sha256"]).replace(/[^0-9A-F]/gi, "").toLowerCase())
      .toContain(issued.fingerprint);
  });

  const extractCert = (issued: { pfx: Uint8Array; password: string }, file: string) => {
    const pfxPath = join(dir, `${file}.pfx`);
    writeFileSync(pfxPath, issued.pfx);
    const certPath = join(dir, `${file}.pem`);
    writeFileSync(certPath, openssl(["pkcs12", "-in", pfxPath, "-passin", `pass:${issued.password}`, "-nokeys", "-clcerts"]));
    return certPath;
  };

  it("vale 10 anos para o Dispositivo e 20 para a CA, e serve só para autenticar cliente", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const created = await DeviceCertificateAuthority.create({ commonName: "CA validade", now });
    const issued = await new DeviceCertificateAuthority(created).issue({ name: "Celular 1", now });

    expect(issued.notAfter.toISOString()).toBe("2036-01-01T00:00:00.000Z");

    const caPath = join(dir, "ca-validade.pem");
    writeFileSync(caPath, created.certificatePem);
    expect(openssl(["x509", "-in", caPath, "-noout", "-enddate"])).toContain("2046");

    const text = openssl(["x509", "-in", extractCert(issued, "celular1"), "-noout", "-text"]);
    expect(text).toContain("TLS Web Client Authentication");
    expect(text).toContain("CA:FALSE");
  });

  it("não aceita certificado emitido por outra CA", async () => {
    const other = await DeviceCertificateAuthority.create({ commonName: "Outra CA" });
    const issued = await new DeviceCertificateAuthority(other).issue({ name: "Intruso" });

    const caPath = join(dir, "ca-original.pem");
    writeFileSync(caPath, caPem);
    expect(() => openssl(["verify", "-CAfile", caPath, extractCert(issued, "intruso")])).toThrow();
  });

  it("gera senha e fingerprint próprios a cada emissão", async () => {
    const a = await ca.issue({ name: "A" });
    const b = await ca.issue({ name: "A" });
    expect(a.password).not.toBe(b.password);
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
