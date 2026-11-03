import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USERNAME } from "./credentials";

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Usuário").fill(ADMIN_USERNAME);
  await page.getByLabel("Senha", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("link", { name: "Usuários", exact: true })).toBeVisible();
}

/** Navega pelo menu lateral (o token vive so em memoria: recarregar a pagina nao e uma opcao). */
export async function openMenu(page: Page, name: string): Promise<void> {
  await page.locator('[data-sidebar="sidebar"]').getByRole("link", { name, exact: true }).click();
}

/**
 * Login do administrador pela API, nos dois passos que o navegador faria: a senha abre o desafio (e grava o cookie
 * dele no `request`), a CA lê o certificado e devolve o callback, e o callback troca o código pelos tokens.
 */
export async function apiLoginAsAdmin(request: APIRequestContext): Promise<string> {
  const first = (await (await request.post("/api/auth/login", { data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD } })).json()) as { verifyUrl: string };
  const callback = new URL((await request.get(first.verifyUrl, { maxRedirects: 0 })).headers()["location"]!);
  const done = await request.post("/api/auth/login/certificate", {
    data: { challengeId: callback.searchParams.get("challenge"), code: callback.searchParams.get("code") ?? undefined },
  });
  return ((await done.json()) as { accessToken: string }).accessToken;
}
