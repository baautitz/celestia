// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable } from "./data-table";

type Row = { id: string; name: string };
const rows: Row[] = [{ id: "1", name: "Alfa" }];
const columns = [{ key: "name", label: "Nome", value: (r: Row) => r.name }];

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function renderTable() {
  render(
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      renderExpanded={(r) => <span>Detalhe de {r.name}</span>}
    />,
  );
}

afterEach(cleanup);

describe.each([
  ["desktop", 1280],
  ["mobile", 500],
])("DataTable linha expansível (%s)", (_name, width) => {
  it("expande e recolhe pelo botão", async () => {
    setViewport(width);
    renderTable();
    const button = await screen.findByRole("button", { name: "Expandir linha" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Detalhe de Alfa")).toBeNull();

    await userEvent.click(button);
    expect(screen.getByText("Detalhe de Alfa")).toBeTruthy();
    const open = screen.getByRole("button", { name: "Recolher linha" });
    expect(open.getAttribute("aria-expanded")).toBe("true");

    await userEvent.click(open);
    expect(screen.queryByText("Detalhe de Alfa")).toBeNull();
  });

  it("é acessível por teclado (Enter e Espaço)", async () => {
    setViewport(width);
    renderTable();
    const button = await screen.findByRole("button", { name: "Expandir linha" });
    await userEvent.tab();
    expect(document.activeElement).toBe(button);
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("Detalhe de Alfa")).toBeTruthy();
    await userEvent.keyboard(" ");
    expect(screen.queryByText("Detalhe de Alfa")).toBeNull();
  });
});
