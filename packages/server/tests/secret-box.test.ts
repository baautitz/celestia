import { describe, it, expect, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "../src/erp/secret-box.js";

describe("secret-box (AES-256-GCM)", () => {
  beforeEach(() => {
    process.env.ERP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("cifra e decifra, sem repetir o texto cifrado", () => {
    const a = encryptSecret("S3nha!db");
    expect(a).not.toContain("S3nha");
    expect(decryptSecret(a)).toBe("S3nha!db");
    expect(encryptSecret("S3nha!db")).not.toBe(a);
  });

  it("falha com a chave errada ou texto adulterado", () => {
    const a = encryptSecret("segredo");
    process.env.ERP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => decryptSecret(a)).toThrow();
  });

  it("recusa chave inválida", () => {
    process.env.ERP_ENCRYPTION_KEY = "curta";
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});
