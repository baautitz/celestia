import { expect, test } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USERNAME } from "./credentials";
import { loginAsAdmin, openMenu } from "./helpers";

test("lista os Períodos de Fechamento", async ({ page, request }) => {
  const login = await request.post("/api/auth/login", { data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD } });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const created = await request.post("/api/closing-periods", {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { name: "Fechamento Janeiro", startDate: "2026-01-01", endDate: "2026-01-31" },
  });
  expect(created.status()).toBe(201);

  await loginAsAdmin(page);
  await openMenu(page, "Períodos de Fechamento");

  const row = page.getByRole("row", { name: /Fechamento Janeiro/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("01/01/2026");
  await expect(row).toContainText("31/01/2026");
  await expect(row).toContainText("Aberto");
});
