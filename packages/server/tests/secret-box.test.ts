import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { assertEncryptionKey, decryptSecret, encryptSecret } from "../src/erp/secret-box.js";

describe("secret-box (AES-128-GCM)", () => {
  beforeEach(() => {
    vi.stubEnv("ERP_ENCRYPTION_KEY", randomBytes(16).toString("hex"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("cifra e decifra, sem repetir o texto cifrado", () => {
    const a = encryptSecret("S3nha!db");
    expect(a).not.toContain("S3nha");
    expect(decryptSecret(a)).toBe("S3nha!db");
    expect(encryptSecret("S3nha!db")).not.toBe(a);
  });

  it("falha com a chave errada ou texto adulterado", () => {
    const a = encryptSecret("segredo");
    vi.stubEnv("ERP_ENCRYPTION_KEY", randomBytes(16).toString("hex"));
    expect(() => decryptSecret(a)).toThrow();
  });

  it("recusa chave inválida", () => {
    vi.stubEnv("ERP_ENCRYPTION_KEY", "curta");
    expect(() => encryptSecret("x")).toThrow(/16 bytes/);
  });

  it("recusa chave de 16 bytes em base64", () => {
    vi.stubEnv("ERP_ENCRYPTION_KEY", randomBytes(16).toString("base64"));
    expect(() => assertEncryptionKey()).toThrow(/16 bytes/);
  });

  it("assertEncryptionKey recusa chave ausente ou inválida", () => {
    vi.stubEnv("ERP_ENCRYPTION_KEY", undefined);
    expect(() => assertEncryptionKey()).toThrow(/16 bytes/);
    vi.stubEnv("ERP_ENCRYPTION_KEY", "ab".repeat(32));
    expect(() => assertEncryptionKey()).toThrow(/16 bytes/);
  });
});
