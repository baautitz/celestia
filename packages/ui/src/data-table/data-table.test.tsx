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
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
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

describe("tooltip do cabeçalho", () => {
  it("mostra a explicação da coluna ao passar o mouse sobre o rótulo", async () => {
    setViewport(1280);
    render(
      <DataTable
        columns={[{ ...columns[0]!, tooltip: "Nome do registro." }]}
        rows={rows}
        getRowId={(r) => r.id}
      />,
    );
    await userEvent.hover(screen.getByText("Nome"));
    expect(await screen.findByText("Nome do registro.")).toBeTruthy();
  });
});

describe("ordenação do cabeçalho", () => {
  const renderSortable = (firstSort?: "asc" | "desc") => {
    setViewport(1280);
    render(
      <DataTable
        columns={[
          { ...columns[0]!, sortable: true, firstSort },
          { key: "id", label: "Cód.", sortable: true, value: (r: Row) => r.id },
        ]}
        rows={rows}
        getRowId={(r) => r.id}
      />,
    );
    return {
      nome: screen.getByRole("columnheader", { name: "Nome" }),
      cod: screen.getByRole("columnheader", { name: "Cód." }),
    };
  };

  it("cicla crescente, decrescente e padrão", async () => {
    const { nome, cod } = renderSortable();
    expect(nome.getAttribute("aria-sort")).toBeNull();

    await userEvent.click(nome);
    expect(nome.getAttribute("aria-sort")).toBe("ascending");
    expect(cod.getAttribute("aria-sort")).toBeNull();

    await userEvent.click(nome);
    expect(nome.getAttribute("aria-sort")).toBe("descending");

    await userEvent.click(nome);
    expect(nome.getAttribute("aria-sort")).toBeNull();

    await userEvent.click(nome);
    await userEvent.click(cod);
    expect(nome.getAttribute("aria-sort")).toBeNull();
    expect(cod.getAttribute("aria-sort")).toBe("ascending");
  });

  it("começa pela direção definida em firstSort", async () => {
    const { nome } = renderSortable("desc");
    await userEvent.click(nome);
    expect(nome.getAttribute("aria-sort")).toBe("descending");
    await userEvent.click(nome);
    expect(nome.getAttribute("aria-sort")).toBe("ascending");
    await userEvent.click(nome);
    expect(nome.getAttribute("aria-sort")).toBeNull();
  });
});
