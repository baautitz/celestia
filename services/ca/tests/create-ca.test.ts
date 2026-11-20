import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCaFiles } from "../src/cli/create-ca.js";
import { DeviceCertificateAuthority } from "../src/authority.js";

const openssl = (args: string[]) => execFileSync("openssl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

describe("create-ca", () => {
  const dir = mkdtempSync(join(tmpdir(), "celestia-ca-files-"));
  const files = { certFile: join(dir, "ca.crt"), keyFile: join(dir, "ca.key") };

  it("grava o certificado e a chave da CA, a chave só para o dono, e não sobrescreve", async () => {
    await createCaFiles({ ...files, commonName: "Celestia CA (teste)" });

    expect(existsSync(files.certFile)).toBe(true);
    expect(statSync(files.keyFile).mode & 0o777).toBe(0o600);
    expect(readFileSync(files.keyFile, "utf8")).toContain("BEGIN PRIVATE KEY");
    expect(openssl(["x509", "-in", files.certFile, "-noout", "-subject"])).toContain("Celestia CA (teste)");

    await expect(createCaFiles({ ...files, commonName: "Outra" })).rejects.toThrow(/já existe/);
    expect(openssl(["x509", "-in", files.certFile, "-noout", "-subject"])).toContain("Celestia CA (teste)");
  });

  it("a CA gravada emite Dispositivos", async () => {
    const ca = new DeviceCertificateAuthority({
      certificatePem: readFileSync(files.certFile, "utf8"),
      privateKeyPem: readFileSync(files.keyFile, "utf8"),
    });
    expect((await ca.issue({ name: "Caixa" })).fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("não deixa a chave sozinha nem arquivos temporários se gravar o certificado falha", async () => {
    const root = mkdtempSync(join(tmpdir(), "celestia-ca-partial-"));
    const keyDir = join(root, "key");
    const certDir = join(root, "cert");
    mkdirSync(keyDir);
    mkdirSync(certDir);
    chmodSync(certDir, 0o500); // o certificado não pode ser gravado
    const partial = { certFile: join(certDir, "ca.crt"), keyFile: join(keyDir, "ca.key") };

    try {
      await expect(createCaFiles({ ...partial, commonName: "Parcial" })).rejects.toThrow();
    } finally {
      chmodSync(certDir, 0o700);
    }
    expect(readdirSync(keyDir)).toEqual([]);
    expect(readdirSync(certDir)).toEqual([]);
    await createCaFiles({ ...partial, commonName: "Parcial" });
    expect(existsSync(partial.keyFile) && existsSync(partial.certFile)).toBe(true);
  });
});
