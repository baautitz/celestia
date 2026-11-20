import { expect, test } from "@playwright/test";
import { CERT_DEVICE_NAME, CERT_PASSWORD, CERT_USERNAME } from "./credentials";
import { loginAsAdmin, openMenu, provisionCertificateDevice } from "./helpers";

const signIn = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.getByLabel("Usuário").fill(CERT_USERNAME);
  await page.getByLabel("Senha", { exact: true }).fill(CERT_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
};

test.describe("login por certificado de Dispositivo", () => {
  // Cada teste tem o seu Dispositivo, emitido na hora: nenhum depende do que o outro fez (revogar, por exemplo).
  test.beforeEach(async ({ request }) => {
    await provisionCertificateDevice(request, CERT_DEVICE_NAME);
  });

  test("pede o certificado só depois da senha, passa pela autoridade e entra no sistema", async ({ page }) => {
    await signIn(page);

    // A autoridade certificadora lê o certificado e devolve o navegador ao app, já logado.
    await expect(page.getByRole("link", { name: "Usuários", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar" })).toBeHidden();
  });

  test("sair e entrar de novo pelo certificado leva ao sistema, sem pedir a senha duas vezes", async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole("link", { name: "Usuários", exact: true })).toBeVisible();

    await page.locator('[data-sidebar="sidebar"]').getByRole("button", { name: /Usuário com Certificado E2E/ }).click();
    await page.getByRole("menuitem", { name: "Sair da Plataforma" }).click();
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();

    await signIn(page);
    // Depois da volta da CA a sessão precisa estar aberta: nada de cair de novo na tela de login.
    await expect(page.getByRole("link", { name: "Usuários", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar" })).toBeHidden();
  });

  test("depois de revogar o Dispositivo, o mesmo login é negado com a mensagem do servidor", async ({ page, browser, baseURL }) => {
    await loginAsAdmin(page);
    await openMenu(page, "Dispositivos");
    const row = page.getByRole("row", { name: new RegExp(CERT_DEVICE_NAME) });
    await row.getByRole("button", { name: "Revogar Dispositivo" }).click();
    await page.getByRole("button", { name: "Revogar", exact: true }).click();
    await expect(row.getByText("Revogado")).toBeVisible();

    // Outro navegador, sem a sessão do administrador.
    const context = await browser.newContext({ baseURL });
    try {
      const other = await context.newPage();
      await signIn(other);
      // Volta à tela de login com o erro num aviso.
      await expect(other.getByText("Dispositivo não autorizado.")).toBeVisible();
      await expect(other.getByRole("button", { name: "Entrar" })).toBeVisible();
      await expect(other).toHaveURL(/\/login$/);
    } finally {
      await context.close();
    }
  });
});
