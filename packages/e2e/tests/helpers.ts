import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { z } from "zod";
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

/** Falha com o status e o corpo da resposta, em vez de seguir adiante com um valor que não existe. */
async function expectOk(res: APIResponse, what: string): Promise<void> {
  if (!res.ok()) throw new Error(`${what} falhou: HTTP ${res.status()} ${await res.text()}`);
}

/**
 * Login do administrador pela API, nos dois passos que o navegador faria: a senha abre o desafio (e grava o cookie
 * dele no `request`), a CA lê o certificado e devolve o callback, e o callback troca o código pelos tokens.
 */
export async function apiLoginAsAdmin(request: APIRequestContext): Promise<string> {
  const first = await request.post("/api/auth/login", { data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD } });
  await expectOk(first, "Login do administrador (senha)");
  const { verifyUrl } = z.object({ verifyUrl: z.string() }).parse(await first.json());

  const verify = await request.get(verifyUrl, { maxRedirects: 0 });
  const location = verify.headers().location;
  if (verify.status() !== 302 || !location) throw new Error(`Leitura do certificado esperava um redirecionamento, veio HTTP ${verify.status()} ${await verify.text()}`);
  const callback = new URL(location);

  const done = await request.post("/api/auth/login/certificate", {
    data: { challengeId: callback.searchParams.get("challenge"), code: callback.searchParams.get("code") ?? undefined },
  });
  await expectOk(done, "Login do administrador (certificado)");
  return z.object({ accessToken: z.string() }).parse(await done.json()).accessToken;
}

/**
 * Deixa exatamente um Dispositivo ativo chamado `name`, emitido agora, para o teste não depender do que outro deixou:
 * o administrador remove os de mesmo nome (revoga e exclui) e emite um novo. A CA do e2e apresenta esse nome na leitura.
 */
export async function provisionCertificateDevice(request: APIRequestContext, name: string): Promise<void> {
  const headers = { Authorization: `Bearer ${await apiLoginAsAdmin(request)}` };
  const list = await request.get("/api/iam/devices", { headers });
  await expectOk(list, "Listar Dispositivos");
  const existing = z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })).parse(await list.json());
  for (const device of existing.filter((d) => d.name === name)) {
    if (device.status === "active") await expectOk(await request.post(`/api/iam/devices/${device.id}/revoke`, { headers }), "Revogar Dispositivo");
    await expectOk(await request.delete(`/api/iam/devices/${device.id}`, { headers }), "Excluir Dispositivo");
  }
  await expectOk(await request.post("/api/iam/devices", { headers, data: { name } }), "Emitir Dispositivo");
}
