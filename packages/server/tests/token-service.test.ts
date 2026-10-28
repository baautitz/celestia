import { describe, it, expect } from "vitest";
import { sign } from "hono/jwt";
import { TokenService } from "../src/iam/token-service.js";

const SECRET = "x".repeat(32);
const exp = () => Math.floor(Date.now() / 1000) + 300;
const valid = { sub: "usr_1", role: "role_a", username: "ana", fullname: "Ana Teste", permissions: ["a:b:c"] };

describe("TokenService.verifyAccessToken", () => {
  const svc = new TokenService({ jwtSecret: SECRET });
  const verifyWith = async (claims: Record<string, unknown>) =>
    svc.verifyAccessToken(await sign({ ...claims, exp: exp() }, SECRET));

  it("aceita token com todos os claims obrigatórios", async () => {
    const p = await verifyWith(valid);
    expect(p).toMatchObject(valid);
  });

  it.each([
    ["username ausente", { username: undefined }],
    ["fullname ausente", { fullname: undefined }],
    ["permissions ausente", { permissions: undefined }],
    ["permissions não é array", { permissions: "a:b:c" }],
    ["permissions com item não-string", { permissions: ["a:b:c", 1] }],
  ])("rejeita token malformado: %s", async (_name, override) => {
    await expect(verifyWith({ ...valid, ...override })).rejects.toThrow("Token de acesso inválido.");
  });
});
