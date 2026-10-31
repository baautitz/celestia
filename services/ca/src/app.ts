import { createHash, timingSafeEqual } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { DeviceCertificateAuthority } from "./authority.js";
import { ChallengeStore } from "./challenge-store.js";
import { DeviceNotFoundError, type DeviceStore } from "./device-store.js";

export const MIN_SHARED_SECRET_LENGTH = 32;

export interface CaAppOptions {
  deviceStore: DeviceStore;
  /** Emite os certificados; sem ela a emissão responde 503. */
  authority?: DeviceCertificateAuthority;
  /** Chave em comum com o backend do Celestia: toda chamada dele leva `Authorization: Bearer <chave>`. */
  sharedSecret: string;
  /** Endereço público desta CA (o do proxy com mTLS), usado para montar o link de leitura do certificado. */
  publicUrl: string;
  /** Para onde o navegador volta depois da leitura. Fixo na configuração: nunca vem na URL. */
  callbackUrl: string;
  /** Fingerprint (SHA-256 do DER, hexadecimal) do certificado de cliente da conexão, ou `undefined` se não houve. */
  readCertificate: (c: Context) => string | undefined | Promise<string | undefined>;
  challenges?: ChallengeStore;
}

const sameSecret = (received: string, expected: string): boolean =>
  timingSafeEqual(createHash("sha256").update(received).digest(), createHash("sha256").update(expected).digest());

function requireSharedSecret(secret: string): MiddlewareHandler {
  return async (c, next) => {
    const received = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    if (!received || !sameSecret(received, secret)) return c.json({ error: "Não autorizado." }, 401);
    await next();
  };
}

/**
 * API da autoridade certificadora. O backend do Celestia a chama com a chave em comum para emitir, revogar e
 * consultar Dispositivos e para abrir e trocar desafios de login. O navegador só chega em `GET /verify`, a única
 * rota que lê o certificado de cliente (atrás do proxy com mTLS).
 */
export function createCaApp({
  deviceStore,
  authority,
  sharedSecret,
  publicUrl,
  callbackUrl,
  readCertificate,
  challenges = new ChallengeStore(),
}: CaAppOptions) {
  if (sharedSecret.length < MIN_SHARED_SECRET_LENGTH) {
    throw new Error(`A chave em comum precisa ter ao menos ${MIN_SHARED_SECRET_LENGTH} caracteres.`);
  }
  const app = new Hono();
  const api = requireSharedSecret(sharedSecret);

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/devices", api, async (c) => c.json(await deviceStore.list()));

  app.get("/devices/:id", api, async (c) => {
    const device = await deviceStore.findById(c.req.param("id"));
    return device ? c.json(device) : c.json({ error: new DeviceNotFoundError().message }, 404);
  });

  app.post(
    "/devices",
    api,
    zValidator("json", z.object({ name: z.string().trim().min(1).max(100), createdBy: z.string().optional() })),
    async (c) => {
      if (!authority) return c.json({ error: "A autoridade certificadora não tem a CA configurada." }, 503);
      const { name, createdBy } = c.req.valid("json");
      // O .pfx e a senha só existem nesta resposta: nada além do fingerprint e dos metadados é gravado.
      const issued = await authority.issue({ name });
      const device = await deviceStore.create({
        name,
        fingerprint: issued.fingerprint,
        serial: issued.serial,
        notAfter: issued.notAfter.toISOString(),
        createdBy,
      });
      return c.json({ device, pfx: Buffer.from(issued.pfx).toString("base64"), password: issued.password }, 201);
    },
  );

  app.post("/devices/:id/revoke", api, zValidator("json", z.object({ revokedBy: z.string().optional() })), async (c) => {
    try {
      return c.json(await deviceStore.revoke(c.req.param("id"), c.req.valid("json").revokedBy));
    } catch (err: unknown) {
      if (err instanceof DeviceNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  app.post("/challenges", api, zValidator("json", z.object({ userId: z.string().min(1) })), (c) => {
    const challengeId = challenges.create(c.req.valid("json").userId);
    const verifyUrl = new URL("/verify", publicUrl);
    verifyUrl.searchParams.set("challenge", challengeId);
    return c.json({ challengeId, verifyUrl: verifyUrl.toString() }, 201);
  });

  app.post(
    "/challenges/exchange",
    api,
    zValidator("json", z.object({ challengeId: z.string().min(1), code: z.string().optional() })),
    async (c) => {
      const { challengeId, code } = c.req.valid("json");
      const result = challenges.exchange(challengeId, code);
      if (!result.granted) return c.json({ error: "device_required", userId: result.userId }, 403);
      const device = await deviceStore.findById(result.deviceId);
      // O Dispositivo pode ter sido revogado entre a leitura e a troca.
      if (!device || device.status !== "active") return c.json({ error: "device_required", userId: result.userId }, 403);
      return c.json({ userId: result.userId, deviceId: device.id, deviceName: device.name });
    },
  );

  // Única rota aberta ao navegador. Sempre volta ao app: com o código se há um Dispositivo ativo, sem ele se não há.
  app.get("/verify", async (c) => {
    const challengeId = c.req.query("challenge") ?? "";
    const fingerprint = (await readCertificate(c))?.toLowerCase();
    const device = fingerprint ? await deviceStore.findActiveByFingerprint(fingerprint) : null;
    const code = device ? challenges.bindDevice(challengeId, device.id) : undefined;
    const back = new URL(callbackUrl);
    back.searchParams.set("challenge", challengeId);
    if (code) back.searchParams.set("code", code);
    return c.redirect(back.toString(), 302);
  });

  return app;
}
