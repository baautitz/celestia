import { describe, it, expect, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import { assertEncryptionKey, decryptSecret, encryptSecret } from "../src/erp/secret-box.js";

describe("secret-box (AES-128-GCM)", () => {
  beforeEach(() => {
    process.env.ERP_ENCRYPTION_KEY = randomBytes(16).toString("hex");
  });

  it("cifra e decifra, sem repetir o texto cifrado", () => {
    const a = encryptSecret("S3nha!db");
    expect(a).not.toContain("S3nha");
    expect(decryptSecret(a)).toBe("S3nha!db");
    expect(encryptSecret("S3nha!db")).not.toBe(a);
  });

  it("falha com a chave errada ou texto adulterado", () => {
    const a = encryptSecret("segredo");
    process.env.ERP_ENCRYPTION_KEY = randomBytes(16).toString("hex");
    expect(() => decryptSecret(a)).toThrow();
  });

  it("recusa chave inválida", () => {
    process.env.ERP_ENCRYPTION_KEY = "curta";
    expect(() => encryptSecret("x")).toThrow(/16 bytes/);
  });

  it("recusa chave de 16 bytes em base64", () => {
    process.env.ERP_ENCRYPTION_KEY = randomBytes(16).toString("base64");
    expect(() => assertEncryptionKey()).toThrow(/16 bytes/);
  });

  it("assertEncryptionKey recusa chave ausente ou inválida", () => {
    delete process.env.ERP_ENCRYPTION_KEY;
    expect(() => assertEncryptionKey()).toThrow(/16 bytes/);
    process.env.ERP_ENCRYPTION_KEY = "ab".repeat(32);
    expect(() => assertEncryptionKey()).toThrow(/16 bytes/);
  });
});
