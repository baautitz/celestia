import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function getKey(): Buffer {
  const raw = process.env.ERP_ENCRYPTION_KEY || "";
  if (!/^[0-9a-fA-F]{32}$/.test(raw)) {
    throw new Error("ERP_ENCRYPTION_KEY deve ser uma chave de 16 bytes em hex (32 caracteres).");
  }
  return Buffer.from(raw, "hex");
}

/** Falha no boot, em vez de só quando a primeira senha de ERP for cifrada ou decifrada. */
export function assertEncryptionKey(): void {
  getKey();
}

/** Cifra com AES-128-GCM. Formato: iv.tag.dados (base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-128-gcm", getKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-128-gcm", getKey(), iv!);
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(data!), decipher.final()]).toString("utf8");
}
