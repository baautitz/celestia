// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { AvaliacoesPage } from "./avaliacoes-page";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

const periodo = { id: "p-abril", name: "Abril", startDate: "2027-04-01", endDate: "2027-04-30", status: "open" };
const lojas = [{ codigo: 1, nome: "Centro" }];
const ana = { codigoColaborador: 7, nome: "ANA SOUZA", usuario: "ana.souza", lojas: [1] };
const bia = { codigoColaborador: 8, nome: "BIA LIMA", usuario: null, lojas: [1] };
let contexto: Record<string, unknown>;
let avaliacoes: Record<string, unknown>[] = [];
const avaliacao = (extra: Record<string, unknown> = {}) => ({ id: "av_1", periodoId: periodo.id, codigoColaborador: 7, nomeColaborador: "ANA SOUZA", codigoLoja: 1, descricao: "Atraso no caixa", valor: 12.5, version: 1, criadoEm: "2027-04-10T12:00:00.000Z", ...extra });

beforeEach(() => {
  avaliacoes = [];
  contexto = { podeVer: true, podeGerenciar: true, todasAsLojas: false, vinculado: true, periodos: [periodo], lojas, lojasGerenciadas: lojas };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/contexto")) return contexto;
    if (url.endsWith("/colaboradores")) return [ana, bia];
    if (init?.method === "POST") {
      const nova = avaliacao(JSON.parse(String(init.body)));
      avaliacoes = [nova];
      return nova;
    }
    return avaliacoes;
  });
});
afterEach(cleanup);

const renderizar = () =>
  render(
    <UiProvider>
      <AvaliacoesPage />
    </UiProvider>,
  );

describe("Avaliações", () => {
  it("mostra só as abas que a Permission libera", async () => {
    contexto = { ...contexto, podeGerenciar: false };
    renderizar();
    expect(await screen.findByRole("tab", { name: "Minhas Avaliações" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Avaliações da Loja" })).toBeNull();
  });

  it("o Colaborador vê as suas Avaliações com o total descontado", async () => {
    avaliacoes = [avaliacao(), avaliacao({ id: "av_2", valor: 7.5, descricao: "Uniforme" })];
    renderizar();
    expect(await screen.findByRole("cell", { name: "Uniforme" })).toBeTruthy();
    expect(screen.getAllByText("R$ 20,00").length).toBeGreaterThan(0);
  });

  it("o gestor busca o Colaborador pelo usuário do sistema e lança a Avaliação", async () => {
    contexto = { ...contexto, podeVer: false };
    renderizar();
    fireEvent.click(await screen.findByRole("button", { name: "Nova Avaliação" }));
    const campo = await screen.findByLabelText("Colaborador");
    fireEvent.input(campo, { target: { value: "ana.souza" }, inputType: "insertText" });
    fireEvent.click(await screen.findByRole("option", { name: "7 · ANA SOUZA (ana.souza)" }));
    expect(screen.queryByRole("option", { name: /BIA LIMA/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Atraso no caixa" } });
    fireEvent.change(screen.getByLabelText("Valor descontado"), { target: { value: "1250" } });
    fireEvent.click(screen.getByRole("button", { name: "Lançar" }));
    expect(await screen.findByRole("cell", { name: "ANA SOUZA" })).toBeTruthy();
    const post = apiFetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ descricao: "Atraso no caixa", valor: 12.5, periodoId: periodo.id, codigoColaborador: 7, codigoLoja: 1 });
  });
});
