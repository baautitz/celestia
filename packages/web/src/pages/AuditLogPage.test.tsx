// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { HeaderActionsProvider, useHeaderActions } from "@/context/HeaderActionsContext";
import { toLocalISODate } from "@platform/ui/lib/utils";
import { AuditLogPage } from "./AuditLogPage";

const api = vi.hoisted(() => ({ audit: { list: vi.fn(), facets: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ api }));

const entry = {
  id: "e1",
  occurredAt: "2026-11-02T12:00:00.000Z",
  actorId: "u1",
  actorName: "Ana",
  plugin: "erp",
  action: "closing.close",
  targetType: "closing_period",
  targetId: "cp-1",
  attributes: { motivo: "Fim do mês", total: 3 },
  schemaVersion: 1,
  summary: "Fechou o período",
  deviceId: null,
  deviceName: null,
};

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
  api.audit.list.mockResolvedValue([entry]);
  api.audit.facets.mockResolvedValue({ actors: [{ id: "u1", name: "Ana" }], plugins: ["erp"] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const HeaderSlot = () => <>{useHeaderActions().actions}</>;

function renderPage() {
  return render(
    <UiProvider>
      <HeaderActionsProvider>
        <HeaderSlot />
        <AuditLogPage />
      </HeaderActionsProvider>
    </UiProvider>,
  );
}

describe("AuditLogPage", () => {
  it("abre nos últimos 7 dias, sem os demais filtros", async () => {
    renderPage();
    await screen.findByText("Ana");
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 6);
    expect(api.audit.list).toHaveBeenCalledWith({
      from: toLocalISODate(weekAgo),
      to: toLocalISODate(today),
      actorId: undefined,
      plugin: undefined,
      targetType: undefined,
      targetId: undefined,
    });
  });

  it("esconde os filtros de alvo atrás de \"Mais filtros\" e consulta após a digitação", async () => {
    renderPage();
    await screen.findByText("Ana");
    expect(screen.queryByLabelText("Id do alvo")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mais filtros" }));
    fireEvent.change(screen.getByLabelText("Id do alvo"), { target: { value: "cp-1" } });
    await waitFor(() => expect(api.audit.list).toHaveBeenLastCalledWith(expect.objectContaining({ targetId: "cp-1" })));
  });

  it("mostra o resumo na linha e expande os atributos na própria lista", async () => {
    renderPage();
    expect(await screen.findByText("Fechou o período")).toBeTruthy();
    expect(screen.getByText("closing.close")).toBeTruthy();
    expect(screen.queryByText("motivo")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expandir linha" }));
    expect(await screen.findByText("motivo")).toBeTruthy();
    expect(screen.getByText("Fim do mês")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("busca nas entradas carregadas pelo resumo", async () => {
    api.audit.list.mockResolvedValue([entry, { ...entry, id: "e2", actorName: "Bruno", summary: "Criou o usuário" }]);
    renderPage();
    await screen.findByText("Bruno");
    fireEvent.change(screen.getByPlaceholderText("Buscar..."), { target: { value: "criou" } });
    await waitFor(() => expect(screen.queryByText("Ana")).toBeNull());
    expect(screen.getByText("Bruno")).toBeTruthy();
  });

  it("no celular, aplica os filtros do drawer de uma vez, com os de alvo à vista", async () => {
    renderPage();
    await screen.findByText("Ana");
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    const drawer = await screen.findByRole("dialog", { name: "Filtros" });
    fireEvent.change(within(drawer).getByLabelText("Id do alvo"), { target: { value: "cp-9" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(api.audit.list).toHaveBeenLastCalledWith(expect.objectContaining({ targetId: "cp-9" })));
    expect(screen.getByText("Id do alvo: cp-9")).toBeTruthy();
  });

  it("descarta uma resposta atrasada que chega depois da mais nova", async () => {
    let slow: (rows: unknown[]) => void = () => {};
    api.audit.list.mockImplementationOnce(() => new Promise((r) => (slow = r)));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Mais filtros" }));
    fireEvent.change(screen.getByLabelText("Id do alvo"), { target: { value: "cp-1" } });
    await screen.findByText("Ana");
    slow([{ ...entry, id: "old", actorName: "Velho" }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Velho")).toBeNull();
  });
});
