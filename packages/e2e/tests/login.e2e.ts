import { expect, test } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USERNAME } from "./credentials";

test.describe("login", () => {
  test("rejeita senha incorreta e permanece na tela de login", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Usuário").fill(ADMIN_USERNAME);
    await page.getByLabel("Senha").fill("Errada@123");
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    await expect(page.getByLabel("Usuário")).toBeVisible();
  });

  test("valida campos obrigatorios", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("Informe o nome de usuário")).toBeVisible();
    await expect(page.getByText("Informe a senha")).toBeVisible();
  });

  test("entra com credenciais validas e sai da tela de login", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Usuário").fill(ADMIN_USERNAME);
    await page.getByLabel("Senha").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page.getByRole("button", { name: "Entrar" })).toBeHidden();
    await expect(page.getByRole("link", { name: "Usuários", exact: true })).toBeVisible();
  });
});
