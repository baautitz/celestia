import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { DeviceCertificateAuthority } from "../src/authority.js";

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

  // O Windows só importa o .pfx no formato legado: PBE-SHA1-3DES na chave e no certificado, e MAC HMAC-SHA1 do PKCS#12.
  it("gera o .pfx no formato legado (3DES + MAC SHA-1) que o Windows importa", async () => {
    const issued = await ca.issue({ name: "Windows" });
    const pfxPath = join(dir, "windows.pfx");
    writeFileSync(pfxPath, issued.pfx);

    const run = spawnSync("openssl", ["pkcs12", "-in", pfxPath, "-passin", `pass:${issued.password}`, "-info", "-noout"], { encoding: "utf8" });
    const info = `${run.stdout}${run.stderr}`;
    expect(run.status).toBe(0);
    expect(info.match(/-----BEGIN/g) ?? []).toHaveLength(0);
    expect(info).toContain("MAC: sha1");
    expect(info).toContain("pbeWithSHA1And3-KeyTripleDES-CBC");
    expect(info).not.toContain("PBES2");
  });

  it("embute no .pfx o DER original da CA e do Dispositivo, sem o forge reescrever a assinatura", async () => {
    const issued = await ca.issue({ name: "Fiel" });
    const pfxPath = join(dir, "fiel.pfx");
    writeFileSync(pfxPath, issued.pfx);
    const pem = openssl(["pkcs12", "-in", pfxPath, "-passin", `pass:${issued.password}`, "-nokeys"]);
    const bundle = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
    expect(bundle).toHaveLength(2);
    const derOf = (certificate: string) => Buffer.from(certificate.replace(/-----[^-]+-----|\s/g, ""), "base64");
    const sha256 = (der: Buffer) => createHash("sha256").update(der).digest("hex");
    const fingerprints = bundle.map((certificate) => sha256(derOf(certificate)));
    expect(fingerprints).toContain(issued.fingerprint);
    expect(fingerprints).toContain(sha256(derOf(caPem)));
  });

  it("não deixa o forge trocado depois de emitir, nem com emissões concorrentes", async () => {
    const before = forge.pki.certificateToAsn1;
    const issued = await Promise.all([ca.issue({ name: "A" }), ca.issue({ name: "B" }), ca.issue({ name: "C" })]);
    expect(forge.pki.certificateToAsn1).toBe(before);
    expect(new Set(issued.map((i) => i.fingerprint)).size).toBe(3);
  });

  it("identifica as chaves, limita a CA a assinar Dispositivos e tolera relógio atrasado", async () => {
    const now = new Date("2026-06-01T12:00:00Z");
    const created = await DeviceCertificateAuthority.create({ commonName: "CA perfil", now });
    const issued = await new DeviceCertificateAuthority(created).issue({ name: "Perfil", now });

    const caPath = join(dir, "ca-perfil.pem");
    writeFileSync(caPath, created.certificatePem);
    const caText = openssl(["x509", "-in", caPath, "-noout", "-text"]);
    expect(caText).toContain("pathlen:0");
    expect(caText).toContain("Subject Key Identifier");
    expect(caText).toContain("Not Before: Jun  1 11:55:00 2026 GMT");

    const deviceText = openssl(["x509", "-in", extractCert(issued, "perfil"), "-noout", "-text"]);
    const keyId = (text: string, label: string) => new RegExp(`${label}:\\s*(?:keyid:)?([0-9A-F:]{59})`).exec(text)?.[1];
    expect(keyId(deviceText, "X509v3 Authority Key Identifier")).toBe(keyId(caText, "X509v3 Subject Key Identifier"));
    expect(deviceText).toContain("Issuer: CN=CA perfil");
    expect(deviceText).toContain("Not Before: Jun  1 11:55:00 2026 GMT");
  });
});
