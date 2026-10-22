import { expect, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USERNAME } from "./credentials";

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Usuário").fill(ADMIN_USERNAME);
  await page.getByLabel("Senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("link", { name: "Usuários", exact: true })).toBeVisible();
}

/** Navega pelo menu lateral (o token vive so em memoria: recarregar a pagina nao e uma opcao). */
export async function openMenu(page: Page, name: string): Promise<void> {
  await page.getByRole("link", { name, exact: true }).click();
}
