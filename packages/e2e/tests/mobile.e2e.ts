import { expect, test, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USERNAME } from "./credentials";

const PAGES = ["Usuários", "Grupos", "Dispositivos", "ERPs", "Períodos de Fechamento"];

/** Campos com fonte menor que 16px fazem o Safari do iPhone dar zoom ao focar. */
async function smallInputs(page: Page): Promise<string[]> {
  return page.locator("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea").evaluateAll((els) =>
    els
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.id),
  );
}

async function pageOverflows(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

test("no celular, os campos não dão zoom e as páginas cabem na largura da tela", async ({ page }) => {
  await page.goto("/");
  expect(await smallInputs(page)).toEqual([]);
  await page.getByLabel("Usuário").fill(ADMIN_USERNAME);
  await page.getByLabel("Senha", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();

  for (const name of PAGES) {
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    const sidebar = page.locator('[data-sidebar="sidebar"]');
    await sidebar.getByRole("link", { name, exact: true }).click();
    await expect(sidebar).toBeHidden();
    await page.waitForLoadState("networkidle");
    expect(await smallInputs(page), name).toEqual([]);
    expect(await pageOverflows(page), name).toBe(false);
    if (process.env.MOBILE_SHOTS) await page.screenshot({ path: `${process.env.MOBILE_SHOTS}/${name}.png`, fullPage: true });
  }
});
