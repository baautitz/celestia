import { expect, test } from "@playwright/test";
import { loginAsAdmin, openMenu } from "./helpers";

test("cria e edita um grupo de acesso", async ({ page }) => {
  const id = Date.now().toString(36);
  await loginAsAdmin(page);
  await openMenu(page, "Grupos");

  await page.getByRole("button", { name: "Novo Grupo" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Novo Grupo de Acesso" });
  await sheet.getByLabel("Nome do Grupo").fill(`Auditores ${id}`);
  await sheet.getByLabel("Identificador do Grupo (slug)").fill(`auditores-${id}`);
  await sheet.getByLabel("Descrição").fill("Acesso de leitura");
  await sheet.getByRole("button", { name: "Criar Grupo" }).click();

  await expect(page.getByText("Perfil de acesso criado com sucesso!")).toBeVisible();
  await expect(page.getByRole("cell", { name: `Auditores ${id}`, exact: true })).toBeVisible();

  await page.getByRole("row", { name: new RegExp(`auditores-${id}`) }).getByRole("button", { name: "Editar" }).click();
  const edit = page.getByRole("dialog", { name: /Editar Grupo/ });
  await edit.getByLabel("Nome do Grupo").fill(`Auditores Senior ${id}`);
  await edit.getByRole("button", { name: "Salvar Alterações" }).click();

  await expect(page.getByText("Perfil de acesso atualizado com sucesso!")).toBeVisible();
  await expect(page.getByRole("cell", { name: `Auditores Senior ${id}`, exact: true })).toBeVisible();
});
