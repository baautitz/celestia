import { expect, test } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USERNAME } from "./credentials";
import { loginAsAdmin, openMenu } from "./helpers";

test("lista os Períodos de Fechamento", async ({ page, request }) => {
  // Períodos não podem se sobrepor: um dia aleatório distante garante unicidade entre repetições e retentativas.
  const day = new Date(Date.UTC(2100, 0, 1 + Math.floor(Math.random() * 30000)));
  const iso = day.toISOString().slice(0, 10);
  const br = iso.split("-").reverse().join("/");
  const name = `Fechamento ${iso}-${Math.random().toString(36).slice(2, 8)}`;
  const login = await request.post("/api/auth/login", { data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD } });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const created = await request.post("/api/closing-periods", {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { name, startDate: iso, endDate: iso },
  });
  expect(created.status()).toBe(201);

  await loginAsAdmin(page);
  await openMenu(page, "Períodos de Fechamento");

  const row = page.getByRole("row", { name });
  await expect(row).toBeVisible();
  await expect(row).toContainText(br);
  await expect(row).toContainText("Aberto");
});
