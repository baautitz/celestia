// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

const nativePrint = window.print;
afterEach(() => {
  cleanup();
  window.print = nativePrint;
});

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

describe("impressão", () => {
  type Sale = { id: string; seller: string; total: number };
  const sales: Sale[] = [
    { id: "1", seller: "Bruna", total: 300 },
    { id: "2", seller: "Ana", total: 100 },
    { id: "3", seller: "Carla", total: 200 },
  ];
  const saleColumns = [
    { key: "seller", label: "Vendedor", tooltip: "Quem vendeu.", sortable: true, searchable: true, value: (r: Sale) => r.seller },
    { key: "total", label: "Total", sortable: true, format: "currency" as const, value: (r: Sale) => r.total },
  ];

  const stubPrint = () => {
    const print = vi.fn();
    window.print = print;
    return print;
  };

  it("mostra o botão Imprimir só com a prop print", () => {
    setViewport(1280);
    const { rerender } = render(<DataTable columns={saleColumns} rows={sales} getRowId={(r) => r.id} />);
    expect(screen.queryByRole("button", { name: "Imprimir" })).toBeNull();
    rerender(<DataTable columns={saleColumns} rows={sales} getRowId={(r) => r.id} print={{}} />);
    expect(screen.getByRole("button", { name: "Imprimir" })).toBeTruthy();
  });

  it("chama a impressão do navegador ao clicar", async () => {
    setViewport(1280);
    const print = stubPrint();
    render(<DataTable columns={saleColumns} rows={sales} getRowId={(r) => r.id} print={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(print).toHaveBeenCalledOnce();
  });

  const printedTable = () => screen.getByRole("table", { name: "Vendas" });
  const printedSellers = () =>
    within(printedTable())
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0]!.textContent);

  it("imprime todas as linhas da busca e ordenação atuais, ignorando a paginação", async () => {
    setViewport(1280);
    stubPrint();
    const extra = [...sales, { id: "4", seller: "Anderson", total: 50 }];
    render(
      <DataTable
        columns={saleColumns}
        rows={extra}
        getRowId={(r) => r.id}
        title="Vendas"
        search={{}}
        pagination={{ pageSize: 1 }}
        print={{}}
      />,
    );
    await userEvent.type(screen.getByRole("searchbox"), "a");
    await userEvent.click(screen.getByRole("columnheader", { name: "Vendedor" }));
    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(printedSellers()).toEqual(["Ana", "Anderson", "Bruna", "Carla"]);

    fireEvent(window, new Event("afterprint"));
    await userEvent.clear(screen.getByRole("searchbox"));
    await userEvent.type(screen.getByRole("searchbox"), "ar");
    await userEvent.click(screen.getByRole("columnheader", { name: "Vendedor" }));
    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(printedSellers()).toEqual(["Carla"]);
  });

  it("imprime só os rótulos dos cabeçalhos, sem ações nem botões de expandir", async () => {
    setViewport(1280);
    stubPrint();
    render(
      <DataTable
        columns={saleColumns}
        rows={sales}
        getRowId={(r) => r.id}
        title="Vendas"
        rowActions={() => <button type="button">Editar</button>}
        renderExpanded={() => "detalhe"}
        print={{}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    const table = printedTable();
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Vendedor", "Total"]);
    expect(within(table).queryAllByRole("button")).toEqual([]);
    expect(table.querySelectorAll("svg")).toHaveLength(0);
  });

  it("usa a descrição de impressão no lugar da descrição da tela", async () => {
    setViewport(1280);
    stubPrint();
    render(
      <DataTable
        columns={saleColumns}
        rows={sales}
        getRowId={(r) => r.id}
        title="Vendas"
        description="Descrição da tela"
        print={{ description: "Filtros: Plugin inovafarma" }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(screen.getByText("Filtros: Plugin inovafarma")).toBeTruthy();
    expect(screen.getAllByText("Descrição da tela")).toHaveLength(1);
  });

  it("imprime como tabela mesmo no celular", async () => {
    setViewport(500);
    stubPrint();
    render(<DataTable columns={saleColumns} rows={sales} getRowId={(r) => r.id} title="Vendas" print={{}} />);
    expect(screen.queryByRole("table")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(printedSellers()).toEqual(["Bruna", "Ana", "Carla"]);
  });

  it("remove a tabela impressa depois de fechar a impressão", async () => {
    setViewport(1280);
    stubPrint();
    render(<DataTable columns={saleColumns} rows={sales} getRowId={(r) => r.id} title="Vendas" print={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(printedTable()).toBeTruthy();
    fireEvent(window, new Event("afterprint"));
    expect(screen.queryByRole("table", { name: "Vendas" })).toBeNull();
  });

  it("usa o nome do arquivo como título da página durante a impressão e restaura depois", async () => {
    setViewport(1280);
    document.title = "Celestia";
    let titleWhilePrinting = "";
    window.print = vi.fn(() => {
      titleWhilePrinting = document.title;
    });
    render(
      <DataTable
        columns={saleColumns}
        rows={sales}
        getRowId={(r) => r.id}
        title="Vendas"
        print={{ fileName: "Vendas - Outubro 2026" }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(titleWhilePrinting).toBe("Vendas - Outubro 2026");
    fireEvent(window, new Event("afterprint"));
    expect(document.title).toBe("Celestia");
  });

  it("usa o título da tabela como nome do arquivo por padrão", async () => {
    setViewport(1280);
    let titleWhilePrinting = "";
    window.print = vi.fn(() => {
      titleWhilePrinting = document.title;
    });
    render(<DataTable columns={saleColumns} rows={sales} getRowId={(r) => r.id} title="Vendas" print={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(titleWhilePrinting).toBe("Vendas");
  });

  it.each([
    ["carregando", { loading: true }],
    ["sem linhas", { rows: [] }],
    ["com paginação no servidor", { manual: true, pagination: { page: 1, totalPages: 3, onPageChange: () => {} } }],
  ])("desabilita o botão quando está %s", (_name, props) => {
    setViewport(1280);
    render(<DataTable columns={saleColumns} rows={sales} getRowId={(r) => r.id} print={{}} {...props} />);
    expect(screen.getByRole("button", { name: "Imprimir" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("grupo de colunas", () => {
  type Seller = { id: string; nome: string; qtd: number; valor: number };
  const sellers: Seller[] = [{ id: "1", nome: "Ana", qtd: 3, valor: 90 }];
  const groupedColumns = [
    { key: "nome", label: "Colaborador", value: (r: Seller) => r.nome },
    { key: "vit-qtd", label: "Qtde", group: "Vitaminas", format: "number" as const, value: (r: Seller) => r.qtd },
    { key: "vit-valor", label: "Valor (R$)", group: "Vitaminas", format: "currency" as const, value: (r: Seller) => r.valor },
  ];

  const groupHeader = (table: HTMLElement) =>
    within(table).getByRole("columnheader", { name: "Vitaminas" }) as HTMLTableCellElement;

  it("mostra o rótulo do grupo sobre as colunas do grupo", () => {
    setViewport(1280);
    render(<DataTable columns={groupedColumns} rows={sellers} getRowId={(r) => r.id} />);
    const table = screen.getByRole("table");
    expect(groupHeader(table).colSpan).toBe(2);
    expect(within(table).getByRole("columnheader", { name: "Qtde" })).toBeTruthy();
  });

  it("repete o grupo na tabela impressa", async () => {
    setViewport(1280);
    window.print = vi.fn();
    render(<DataTable columns={groupedColumns} rows={sellers} getRowId={(r) => r.id} title="Vendas" print={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(groupHeader(screen.getByRole("table", { name: "Vendas" })).colSpan).toBe(2);
  });

  it("formata decimal com duas casas e sem símbolo de moeda", () => {
    setViewport(1280);
    render(
      <DataTable
        columns={[{ key: "valor", label: "Valor (R$)", format: "decimal" as const, value: (r: Seller) => r.valor }]}
        rows={[{ id: "1", nome: "Ana", qtd: 3, valor: 3388.3 }]}
        getRowId={(r) => r.id}
      />,
    );
    expect(screen.getByRole("cell", { name: "3.388,30" })).toBeTruthy();
  });

  it("prefixa o rótulo com o grupo no celular", () => {
    setViewport(500);
    render(<DataTable columns={groupedColumns} rows={sellers} getRowId={(r) => r.id} />);
    expect(screen.getByText("Vitaminas · Qtde")).toBeTruthy();
    expect(screen.getByText("Vitaminas · Valor (R$)")).toBeTruthy();
  });
});

describe("colunas fixas", () => {
  type Seller = { id: string; codigo: number; nome: string; total: number };
  const sellers: Seller[] = [{ id: "1", codigo: 7, nome: "Ana", total: 90 }];
  const freezeColumns = [
    { key: "codigo", label: "Cód.", value: (r: Seller) => r.codigo },
    { key: "nome", label: "Colaborador", value: (r: Seller) => r.nome },
    { key: "total", label: "Total", format: "number" as const, value: (r: Seller) => r.total },
  ];

  const isFrozen = (name: string) => screen.getByRole("cell", { name }).style.position === "sticky";

  it("não fixa colunas sem frozenUntil", () => {
    setViewport(1280);
    render(<DataTable columns={freezeColumns} rows={sellers} getRowId={(r) => r.id} />);
    expect([isFrozen("7"), isFrozen("Ana"), isFrozen("90")]).toEqual([false, false, false]);
  });

  it("fixa as colunas até a coluna informada, com o cabeçalho", () => {
    setViewport(1280);
    render(<DataTable columns={freezeColumns} rows={sellers} getRowId={(r) => r.id} frozenUntil="nome" />);
    expect([isFrozen("7"), isFrozen("Ana"), isFrozen("90")]).toEqual([true, true, false]);
    expect(screen.getByRole("columnheader", { name: "Colaborador" }).style.position).toBe("sticky");
    expect(screen.getByRole("columnheader", { name: "Total" }).style.position).toBe("");
  });
});

describe("comparação com o anterior", () => {
  type Seller = { id: string; nome: string; liquido: number };
  const sellers: Seller[] = [
    { id: "1", nome: "Ana", liquido: 12340 },
    { id: "2", nome: "Bruno", liquido: 500 },
  ];
  const previous: Record<string, number> = { "1": 11000 };
  const comparedColumns = [
    { key: "nome", label: "Colaborador", value: (r: Seller) => r.nome },
    {
      key: "liquido",
      label: "Total Líquido (R$)",
      format: "decimal" as const,
      value: (r: Seller) => r.liquido,
      compare: (r: Seller) => {
        const p = previous[r.id];
        return p === undefined ? undefined : { previous: p, label: "Setembro/2026" };
      },
    },
  ];

  it("mostra o detalhe ao passar o mouse sobre a célula no desktop", async () => {
    setViewport(1280);
    render(<DataTable columns={comparedColumns} rows={sellers} getRowId={(r) => r.id} />);
    expect(screen.queryByText(/▲/)).toBeNull();

    await userEvent.hover(screen.getByRole("cell", { name: "12.340,00" }));
    expect(await screen.findByText("Setembro/2026")).toBeTruthy();
    expect(screen.getByText("11.000,00")).toBeTruthy();
    expect(screen.getByText("▲ 12,2%")).toBeTruthy();
  });

  it("troca o detalhe ao passar para outra célula comparada", async () => {
    setViewport(1280);
    previous["2"] = 1000;
    render(<DataTable columns={comparedColumns} rows={sellers} getRowId={(r) => r.id} />);
    await userEvent.hover(screen.getByRole("cell", { name: "12.340,00" }));
    expect(await screen.findByText("▲ 12,2%")).toBeTruthy();

    await userEvent.hover(screen.getByRole("cell", { name: "500,00" }));
    expect(await screen.findByText("▼ 50,0%")).toBeTruthy();
    expect(screen.queryByText("▲ 12,2%")).toBeNull();
    delete previous["2"];
  });

  it("mostra a variação e o anterior abaixo do valor no celular", () => {
    setViewport(500);
    render(<DataTable columns={comparedColumns} rows={sellers} getRowId={(r) => r.id} />);
    expect(screen.getByText("▲ 12,2% · 11.000")).toBeTruthy();
    expect(screen.getAllByText(/▲/)).toHaveLength(1);
  });

  it("não imprime a comparação", async () => {
    setViewport(500);
    window.print = vi.fn();
    render(<DataTable columns={comparedColumns} rows={sellers} getRowId={(r) => r.id} title="Vendas" print={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(within(screen.getByRole("table", { name: "Vendas" })).queryByText(/▲/)).toBeNull();
  });
});

describe("totalizador", () => {
  type Seller = { id: string; nome: string; qtd: number; valor: number };
  const sellers: Seller[] = [
    { id: "1", nome: "Ana", qtd: 3, valor: 90 },
    { id: "2", nome: "Bia", qtd: 2, valor: 60 },
  ];
  const totalColumns = [
    { key: "nome", label: "Colaborador", value: (r: Seller) => r.nome },
    { key: "qtd", label: "Qtde", format: "number" as const, value: (r: Seller) => r.qtd },
    { key: "valor", label: "Valor (R$)", format: "currency" as const, value: (r: Seller) => r.valor },
  ];

  it("não mostra a linha Total sem totals", () => {
    setViewport(1280);
    render(<DataTable columns={totalColumns} rows={sellers} getRowId={(r) => r.id} />);
    expect(screen.queryByText("Total")).toBeNull();
  });

  it("mostra a linha Total com os valores formatados pela coluna e deixa as demais em branco", () => {
    setViewport(1280);
    render(<DataTable columns={totalColumns} rows={sellers} getRowId={(r) => r.id} totals={{ valor: 150 }} />);
    const footerRow = within(screen.getByRole("table")).getAllByRole("row").at(-1)!;
    const cells = within(footerRow).getAllByRole("cell");
    expect(cells.map((c) => c.textContent?.replace(/\u00a0/g, " "))).toEqual(["Total", "", "R$ 150,00"]);
  });

  it("recalcula o total pela função com as linhas da busca, de todas as páginas", async () => {
    setViewport(1280);
    const many: Seller[] = Array.from({ length: 5 }, (_, i) => ({ id: String(i), nome: i < 4 ? `Ana ${i}` : "Bia", qtd: 1, valor: 10 }));
    const totals = vi.fn((filtered: Seller[]) => ({ valor: filtered.reduce((sum, r) => sum + r.valor, 0) }));
    render(
      <DataTable
        columns={[{ ...totalColumns[0]!, searchable: true }, ...totalColumns.slice(1)]}
        rows={many}
        getRowId={(r) => r.id}
        search={{ placeholder: "Buscar" }}
        pagination={{ pageSize: 2 }}
        totals={totals}
      />,
    );
    const lastCells = () => within(within(screen.getByRole("table")).getAllByRole("row").at(-1)!).getAllByRole("cell");
    expect(lastCells().at(-1)!.textContent?.replace(/\u00a0/g, " ")).toBe("R$ 50,00");

    await userEvent.type(screen.getByPlaceholderText("Buscar"), "Ana");
    expect(lastCells().at(-1)!.textContent?.replace(/\u00a0/g, " ")).toBe("R$ 40,00");
    expect(totals).toHaveBeenLastCalledWith(many.slice(0, 4));
  });

  it("mostra no celular um card Total só com as colunas que têm valor", () => {
    setViewport(500);
    render(<DataTable columns={totalColumns} rows={sellers} getRowId={(r) => r.id} totals={{ valor: 150 }} />);
    expect(screen.getAllByText("Valor (R$)")).toHaveLength(3);
    expect(screen.getAllByText("Qtde")).toHaveLength(2);
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getAllByText(/R\$\s150,00/)).toHaveLength(1);
  });

  it("imprime a linha Total no fim da tabela impressa", async () => {
    setViewport(1280);
    window.print = vi.fn();
    render(
      <DataTable columns={totalColumns} rows={sellers} getRowId={(r) => r.id} title="Vendas" print={{}} totals={{ valor: 150 }} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    const printed = screen.getByRole("table", { name: "Vendas" });
    const cells = within(within(printed).getAllByRole("row").at(-1)!).getAllByRole("cell");
    expect(cells.map((c) => c.textContent?.replace(/\u00a0/g, " "))).toEqual(["Total", "", "R$ 150,00"]);
  });

  it("não mostra a linha Total sem totals no celular nem na impressão", async () => {
    setViewport(500);
    const { unmount } = render(<DataTable columns={totalColumns} rows={sellers} getRowId={(r) => r.id} />);
    expect(screen.queryByText("Total")).toBeNull();
    unmount();

    setViewport(1280);
    window.print = vi.fn();
    render(<DataTable columns={totalColumns} rows={sellers} getRowId={(r) => r.id} title="Vendas" print={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(within(screen.getByRole("table", { name: "Vendas" })).queryByText("Total")).toBeNull();
  });

  it("imprime o total calculado pela função com as linhas da busca", async () => {
    setViewport(1280);
    window.print = vi.fn();
    render(
      <DataTable
        columns={totalColumns}
        rows={sellers}
        getRowId={(r) => r.id}
        title="Vendas"
        print={{}}
        totals={(filtered) => ({ qtd: filtered.reduce((sum, r) => sum + r.qtd, 0) })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    const cells = within(within(screen.getByRole("table", { name: "Vendas" })).getAllByRole("row").at(-1)!).getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual(["Total", "5", ""]);
  });

  it("deixa a linha Total por último, depois das linhas da página", () => {
    setViewport(1280);
    render(<DataTable columns={totalColumns} rows={sellers} getRowId={(r) => r.id} totals={{ valor: 150 }} />);
    const rowsInTable = within(screen.getByRole("table")).getAllByRole("row");
    expect(rowsInTable.map((r) => (r.firstElementChild as HTMLElement).textContent)).toEqual(["Colaborador", "Ana", "Bia", "Total"]);
    expect(screen.getByRole("table").querySelector("tfoot")?.className).not.toContain("sticky");
  });

  it("esconde a linha Total quando a tabela está vazia ou carregando", () => {
    setViewport(1280);
    const { rerender } = render(<DataTable columns={totalColumns} rows={[]} getRowId={(r) => r.id} totals={{ valor: 0 }} />);
    expect(screen.queryByText("Total")).toBeNull();
    rerender(<DataTable columns={totalColumns} rows={sellers} getRowId={(r) => r.id} loading totals={{ valor: 150 }} />);
    expect(screen.queryByText("Total")).toBeNull();
  });

  it("imprime o total como grupo de linhas comum, para não se repetir em toda folha", async () => {
    setViewport(1280);
    window.print = vi.fn();
    render(
      <DataTable columns={totalColumns} rows={sellers} getRowId={(r) => r.id} title="Vendas" print={{}} totals={{ valor: 150 }} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    const footer = screen.getByRole("table", { name: "Vendas" }).querySelector("tfoot");
    expect(footer?.classList.contains("table-row-group")).toBe(true);
  });

  it("compara o Totalizador com o anterior: tooltip no desktop e linha no celular, nada na impressão", async () => {
    type Row = { id: string; nome: string; valor: number };
    const data: Row[] = [{ id: "1", nome: "Ana", valor: 90 }];
    const cols = [
      { key: "nome", label: "Colaborador", value: (r: Row) => r.nome },
      { key: "valor", label: "Valor (R$)", format: "decimal" as const, value: (r: Row) => r.valor },
    ];
    const totalsCompare = { valor: { previous: 100, label: "Setembro/2026" } };

    setViewport(1280);
    window.print = vi.fn();
    const { unmount } = render(
      <DataTable columns={cols} rows={data} getRowId={(r) => r.id} title="Vendas" print={{}} totals={{ valor: 150 }} totalsCompare={totalsCompare} />,
    );
    await userEvent.hover(within(screen.getByRole("table")).getByRole("cell", { name: "150,00" }));
    expect(await screen.findByText("Setembro/2026")).toBeTruthy();
    expect(screen.getByText("100,00")).toBeTruthy();
    expect(screen.getByText("▲ 50,0%")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(within(screen.getByRole("table", { name: "Vendas" })).queryByText(/▲/)).toBeNull();
    unmount();

    setViewport(500);
    render(<DataTable columns={cols} rows={data} getRowId={(r) => r.id} totals={{ valor: 150 }} totalsCompare={totalsCompare} />);
    expect(screen.getByText("▲ 50,0% · 100")).toBeTruthy();
  });
});
