// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HeaderActionsProvider, useHeaderActions } from "@platform/ui/context/header-actions";
import { UiProvider } from "@platform/ui/imperative/provider";
import { PedidosLimitesTab } from "./pedidos-limites-tab";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const cadastro = {
  hoje: "2026-11-15",
  podeGerir: true,
  lojas: [{ codigo: 1, nome: "Centro" }],
  regras: [{ id: "r", nome: "Genéricos", entradas: [{ tipo: "grupo", id: "3", nome: "Genéricos" }], fornecedores: [], version: 1 }],
  valores: [{ id: "v", regraId: "r", inicio: "2026-11-01", fim: "2026-11-30", distribuicao: { tipo: "porLoja", lojas: [{ codigoLoja: 1, valorCentavos: 100_000 }] }, version: 3 }],
};

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/consumo")) return [{ codigoLoja: 1, valorCentavos: 100_000, entradasCentavos: 120_000, comprometidoCentavos: 0, repostoCentavos: 0, saldoCentavos: -20_000 }];
    if (url.endsWith("/fornecedores")) return [];
    return cadastro;
  });
});
afterEach(cleanup);

const HeaderSlot = () => <>{useHeaderActions().actions}</>;
const renderizar = () =>
  render(
    <UiProvider>
      <HeaderActionsProvider>
        <HeaderSlot />
        <PedidosLimitesTab />
      </HeaderActionsProvider>
    </UiProvider>,
  );

describe("aba Limites", () => {
  it("mostra o saldo por Loja e exclui o Valor com a version", async () => {
    renderizar();
    expect(await screen.findByText(/-R\$\s200,00/)).toBeTruthy();
    expect(screen.getByText("Centro")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Excluir Valor de Genéricos de 01/11/2026" }));
    fireEvent.click(await screen.findByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringMatching(/valores\/v\?version=3$/), { method: "DELETE" }));
  });

  it("não lança um Valor sem vigência", async () => {
    renderizar();
    fireEvent.click(await screen.findByRole("button", { name: "Novo valor" }));
    fireEvent.click(await screen.findByRole("button", { name: "Lançar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("AAAA-MM-DD");
    expect(apiFetch).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "POST" }));
  });
});
