import { describe, expect, it } from "vitest";
import type { User } from "@platform/shared";
import { TestUserStore } from "./helpers/fixtures.js";
import { createPlatform } from "../src/index.js";
import { PasswordService } from "../src/iam/password-service.js";

const usuario: User = { id: "ana", username: "ana", fullname: "Ana", passwordHash: PasswordService.hash("Senha@123"), roleId: "vazio", status: "active", createdAt: new Date().toISOString() };

describe("política de senha do IAM", () => {
  it("a tela lê as regras, que batem com a validação do servidor", async () => {
    const platform = createPlatform({ userStore: new TestUserStore({ roles: [{ id: "vazio", name: "Vazio", permissions: [] }], users: [usuario] }) });
    await platform.start();
    expect((await platform.app.request("/api/iam/password-policy")).status).toBe(401);

    const login = await platform.app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "ana", password: "Senha@123" }) });
    const { accessToken } = (await login.json()) as { accessToken: string };
    const res = await platform.app.request("/api/iam/password-policy", { headers: { authorization: `Bearer ${accessToken}` } });
    const { rules } = (await res.json()) as { rules: { label: string; pattern: string }[] };
    expect(rules.map((r) => r.label)).toEqual(["8 caracteres", "1 maiúscula", "1 minúscula", "1 número", "1 especial"]);

    const cumpreTudo = (senha: string) => rules.every((r) => new RegExp(r.pattern).test(senha));
    for (const senha of ["Senha@123", "fraca", "SEMMINUSC@1", "Sem@numero", "Sem1especial"]) {
      expect(cumpreTudo(senha)).toBe(PasswordService.validate(senha).valid);
    }
  });
});
