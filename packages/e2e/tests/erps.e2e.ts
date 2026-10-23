import { expect, test } from "@playwright/test";
import { loginAsAdmin, openMenu } from "./helpers";

test("cadastra um ERP e o exclui", async ({ page }) => {
  await loginAsAdmin(page);
  await openMenu(page, "ERPs");

  await page.getByRole("button", { name: "Novo ERP" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Novo ERP" });
  await sheet.getByRole("combobox", { name: "ERP Driver" }).click();
  await page.getByRole("option").first().click();
  await sheet.getByLabel("Nome", { exact: true }).fill("InovaFarma");
  await sheet.getByLabel("Identificador (usado nos módulos)").fill("inovafarma");
  await sheet.getByRole("textbox", { name: "Servidor" }).fill("db.invalid");
  await sheet.getByRole("textbox", { name: "Banco de dados" }).fill("farma");
  await sheet.getByRole("textbox", { name: "Usuário" }).fill("sa");
  await sheet.getByLabel("Senha", { exact: true }).fill("Segredo@123");
  await sheet.getByRole("button", { name: "Cadastrar ERP" }).click();

  await expect(page.getByText("ERP cadastrado com sucesso!")).toBeVisible();
  const row = page.getByRole("row", { name: /InovaFarma/ });
  await expect(row).toBeVisible();

  await row.getByRole("button").last().click();
  await page.getByRole("menuitem", { name: /Excluir/ }).click();
  await page.getByRole("alertdialog", { name: "Excluir ERP" }).getByRole("button", { name: /Excluir/ }).click();

  await expect(page.getByText("ERP excluído.")).toBeVisible();
  await expect(page.getByRole("row", { name: /InovaFarma/ })).toHaveCount(0);
});
