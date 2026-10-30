import { expect, test } from "@playwright/test";
import { loginAsAdmin, openMenu } from "./helpers";

test("emite um Dispositivo, mostra a senha do certificado e o revoga", async ({ page }) => {
  const name = `Caixa ${Date.now().toString(36)}`;
  await loginAsAdmin(page);
  await openMenu(page, "Dispositivos");

  await page.getByRole("button", { name: "Novo Dispositivo" }).first().click();
  const issue = page.getByRole("dialog", { name: "Novo Dispositivo" });
  await issue.getByRole("button", { name: "Emitir certificado" }).click();
  await expect(issue.getByText("Informe o nome do Dispositivo.")).toBeVisible();

  await issue.getByLabel("Nome do Dispositivo").fill(name);
  await issue.getByRole("button", { name: "Emitir certificado" }).click();

  await expect(page.getByText("Dispositivo emitido com sucesso.")).toBeVisible();
  const issued = page.getByRole("dialog", { name: "Certificado emitido" });
  await expect(issued.getByText(/A senha aparece só agora/)).toBeVisible();
  const download = page.waitForEvent("download");
  await issued.getByRole("button", { name: "Baixar certificado" }).click();
  expect((await download).suggestedFilename()).toBe(`${name.replace(/ /g, "-")}.pfx`);
  await issued.getByRole("button", { name: "Concluir" }).click();

  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row.getByText("Ativo")).toBeVisible();

  await row.getByRole("button", { name: "Revogar Dispositivo" }).click();
  await page.getByRole("button", { name: "Revogar", exact: true }).click();
  await expect(page.getByText("Certificado revogado com sucesso.")).toBeVisible();
  await expect(row.getByText("Revogado")).toBeVisible();
  await expect(row.getByRole("button", { name: "Revogar Dispositivo" })).toHaveCount(0);
});
