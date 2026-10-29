// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UiProvider, useUi } from "./provider";
import { WindowActions, useWindow } from "./use-window";
import type { WindowResult } from "../contracts/windows";

afterEach(cleanup);

function Body() {
  const { resolve, setDirtyCheck } = useWindow<string>();
  return (
    <>
      <p>Conteudo da janela</p>
      <WindowActions>
        <button type="button" onClick={() => resolve("salvo")}>Salvar</button>
        <button type="button" onClick={() => setDirtyCheck(() => true)}>Sujar</button>
      </WindowActions>
    </>
  );
}

function Launcher({ onResult }: { onResult: (r: WindowResult<unknown> | boolean) => void }) {
  const ui = useUi();
  return (
    <>
      <button type="button" onClick={async () => onResult(await ui.windows.open<string>({ surface: "sheet", title: "Minha janela", content: Body }))}>
        Abrir janela
      </button>
      <button type="button" onClick={async () => onResult(await ui.windows.confirm({ title: "Excluir item", confirmLabel: "Excluir" }))}>
        Abrir confirmacao
      </button>
    </>
  );
}

function setup() {
  const results: Array<WindowResult<unknown> | boolean> = [];
  render(
    <UiProvider>
      <Launcher onResult={(r) => results.push(r)} />
    </UiProvider>,
  );
  return results;
}

describe("host de janelas (UiProvider)", () => {
  it("abre uma janela, publica as acoes no rodape e resolve com o valor", async () => {
    const results = setup();
    fireEvent.click(screen.getByRole("button", { name: "Abrir janela" }));

    const dialog = await screen.findByRole("dialog", { name: "Minha janela" });
    expect(dialog.textContent).toContain("Conteudo da janela");

    fireEvent.click(await screen.findByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(results).toEqual([{ status: "confirmed", value: "salvo" }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Escape fecha uma janela limpa como cancelada", async () => {
    const results = setup();
    fireEvent.click(screen.getByRole("button", { name: "Abrir janela" }));
    const dialog = await screen.findByRole("dialog", { name: "Minha janela" });

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(results).toEqual([{ status: "cancelled", reason: "escape" }]));
  });

  it("janela suja pede confirmacao de descarte antes de fechar", async () => {
    const results = setup();
    fireEvent.click(screen.getByRole("button", { name: "Abrir janela" }));
    const dialog = await screen.findByRole("dialog", { name: "Minha janela" });
    fireEvent.click(await screen.findByRole("button", { name: "Sujar" }));

    fireEvent.keyDown(dialog, { key: "Escape" });
    const alert = await screen.findByRole("alertdialog", { name: "Descartar alterações?" });
    expect(results).toEqual([]);

    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(results).toEqual([{ status: "cancelled", reason: "discarded" }]));
    await waitFor(() => expect(alert.isConnected).toBe(false));
  });

  it("confirm() devolve true ao confirmar e false ao cancelar", async () => {
    const results = setup();
    fireEvent.click(screen.getByRole("button", { name: "Abrir confirmacao" }));
    await screen.findByRole("alertdialog", { name: "Excluir item" });
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(results).toEqual([true]));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Abrir confirmacao" }));
    await screen.findByRole("alertdialog", { name: "Excluir item" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(results).toEqual([true, false]));
  });
});

describe("superfície drawer", () => {
  function DrawerLauncher({ onResult }: { onResult: (r: WindowResult<unknown>) => void }) {
    const ui = useUi();
    return (
      <button type="button" onClick={async () => onResult(await ui.windows.open<string>({ surface: "drawer", title: "Filtros", content: Body }))}>
        Abrir drawer
      </button>
    );
  }

  it("abre por baixo, publica as ações no rodapé e resolve com o valor", async () => {
    const results: WindowResult<unknown>[] = [];
    render(
      <UiProvider>
        <DrawerLauncher onResult={(r) => results.push(r)} />
      </UiProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Abrir drawer" }));

    const drawer = await screen.findByRole("dialog", { name: "Filtros" });
    expect(drawer.getAttribute("data-side")).toBe("bottom");
    fireEvent.click(await screen.findByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(results).toEqual([{ status: "confirmed", value: "salvo" }]));
  });
});
