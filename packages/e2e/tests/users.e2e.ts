import { expect, test } from "@playwright/test";
import { loginAsAdmin, openMenu } from "./helpers";

test("cadastra um usuario, redefine a senha e o desativa", async ({ page }) => {
  await loginAsAdmin(page);
  await openMenu(page, "Usuários");

  await page.getByRole("button", { name: "Novo Usuário" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Cadastrar Novo Usuário" });
  await sheet.getByLabel("Nome Completo").fill("Carlos Silva");
  await sheet.getByLabel("Nome de Usuário").fill("carlos.silva");
  await sheet.getByLabel("E-mail").fill("carlos@empresa.com");
  await sheet.getByRole("combobox", { name: "Perfil de Acesso" }).click();
  await page.getByRole("option", { name: "Operadores" }).click();
  await sheet.getByLabel("Senha Inicial").fill("Senha@123");
  await sheet.getByRole("button", { name: "Cadastrar Usuário" }).click();

  await expect(page.getByText("Usuário cadastrado com sucesso!")).toBeVisible();
  const row = page.getByRole("row", { name: /carlos\.silva/ });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Redefinir Senha" }).click();
  const reset = page.getByRole("dialog", { name: "Redefinir Senha" });
  await reset.getByLabel("Nova Senha").fill("Outra@1234");
  await reset.getByRole("button", { name: "Salvar Senha" }).click();
  await expect(page.getByText("Senha de carlos.silva redefinida com sucesso!")).toBeVisible();

  await row.getByRole("button", { name: "Desativar Usuário" }).click();
  await expect(page.getByText("Usuário carlos.silva desativado.")).toBeVisible();
  await expect(row.getByRole("button", { name: "Ativar Usuário" })).toBeVisible();
});

test("rejeita senha fora da politica", async ({ page }) => {
  await loginAsAdmin(page);
  await openMenu(page, "Usuários");

  await page.getByRole("button", { name: "Novo Usuário" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Cadastrar Novo Usuário" });
  await sheet.getByLabel("Nome Completo").fill("Maria Souza");
  await sheet.getByLabel("Nome de Usuário").fill("maria.souza");
  await sheet.getByRole("combobox", { name: "Perfil de Acesso" }).click();
  await page.getByRole("option", { name: "Operadores" }).click();
  await sheet.getByLabel("Senha Inicial").fill("fraca");
  await sheet.getByRole("button", { name: "Cadastrar Usuário" }).click();

  await expect(page.getByRole("row", { name: /maria\.souza/ })).toHaveCount(0);
  await expect(sheet).toBeVisible();
});
