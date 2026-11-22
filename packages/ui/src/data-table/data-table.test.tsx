// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable } from "./data-table";
import { defined } from "../test/defined";

type Row = { id: string; name: string };
const rows: Row[] = [{ id: "1", name: "Alfa" }];
const columns = [{ key: "name", label: "Nome", value: (r: Row) => r.name }];

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: width < 1024,
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

  it("buscar com tudo recolhido expande as linhas encontradas e limpar a busca recolhe", async () => {
    setViewport(width);
    render(
      <DataTable
        columns={[{ ...defined(columns[0], "the first column"), searchable: true }]}
        rows={[...rows, { id: "2", name: "Beta" }]}
        getRowId={(r) => r.id}
        search={{}}
        renderExpanded={(r) => <span>Detalhe de {r.name}</span>}
      />,
    );
    const busca = await screen.findByPlaceholderText("Buscar...");
    fireEvent.change(busca, { target: { value: "alf" } });
    expect(await screen.findByText("Detalhe de Alfa")).toBeTruthy();
    expect(screen.queryByText("Beta")).toBeNull();

    fireEvent.change(busca, { target: { value: "" } });
    expect(await screen.findByText("Beta")).toBeTruthy();
    expect(screen.queryByText("Detalhe de Alfa")).toBeNull();
  });

  it("buscar com uma linha já expandida não expande as outras", async () => {
    setViewport(width);
    render(
      <DataTable
        columns={[{ ...defined(columns[0], "the first column"), searchable: true }]}
        rows={[...rows, { id: "2", name: "Beta" }]}
        getRowId={(r) => r.id}
        search={{}}
        renderExpanded={(r) => <span>Detalhe de {r.name}</span>}
      />,
    );
    await userEvent.click(defined((await screen.findAllByRole("button", { name: "Expandir linha" }))[0], "the button"));
    fireEvent.change(screen.getByPlaceholderText("Buscar..."), { target: { value: "a" } });
    expect(screen.getByText("Detalhe de Alfa")).toBeTruthy();
    expect(screen.queryByText("Detalhe de Beta")).toBeNull();
  });

  it("é acessível por teclado (Enter e Espaço)", async () => {
    setViewport(width);
    renderTable();
    const button = await screen.findByRole("button", { name: "Expandir linha" });
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("Detalhe de Alfa")).toBeTruthy();
    await userEvent.keyboard(" ");
    expect(screen.queryByText("Detalhe de Alfa")).toBeNull();
  });
});

describe.each([
  ["desktop", 1280],
  ["mobile", 500],
])("DataTable expandir e recolher todas (%s)", (_name, width) => {
  it("expande e recolhe todas as linhas de uma vez", async () => {
    setViewport(width);
    render(
      <DataTable
        columns={columns}
        rows={[{ id: "1", name: "Alfa" }, { id: "2", name: "Beta" }]}
        getRowId={(r) => r.id}
        renderExpanded={(r) => <span>Detalhe de {r.name}</span>}
      />,
    );
    await userEvent.click(defined((await screen.findAllByRole("button", { name: /Expandir todas/ }))[0], "the button"));
    expect(screen.getByText("Detalhe de Alfa")).toBeTruthy();
    expect(screen.getByText("Detalhe de Beta")).toBeTruthy();

    await userEvent.click(defined(screen.getAllByRole("button", { name: /Recolher todas/ })[0], "the button"));
    expect(screen.queryByText("Detalhe de Alfa")).toBeNull();
    expect(screen.queryByText("Detalhe de Beta")).toBeNull();
  });

  it("com uma linha já aberta, expande as que faltam", async () => {
    setViewport(width);
    render(
      <DataTable
        columns={columns}
        rows={[{ id: "1", name: "Alfa" }, { id: "2", name: "Beta" }]}
        getRowId={(r) => r.id}
        renderExpanded={(r) => <span>Detalhe de {r.name}</span>}
      />,
    );
    await userEvent.click(defined((await screen.findAllByRole("button", { name: "Expandir linha" }))[0], "the button"));
    await userEvent.click(defined(screen.getAllByRole("button", { name: /Expandir todas/ })[0], "the button"));
    expect(screen.getByText("Detalhe de Alfa")).toBeTruthy();
    expect(screen.getByText("Detalhe de Beta")).toBeTruthy();
  });
});

describe("busca", () => {
  type Item = { id: string; name: string };
  const items: Item[] = [
    { id: "1", name: "Caixas da Loja" },
    { id: "2", name: "Fechou o período" },
    { id: "3", name: "Caixa 1" },
    { id: "4", name: "Dispositivo do balcão" },
  ];
  const itemColumns = [{ key: "name", label: "Nome", sortable: true, searchable: true, value: (r: Item) => r.name }];
  const names = () => screen.getAllByRole("row").slice(1).map((r) => defined(within(r).getAllByRole("cell")[0], "the first cell").textContent);

  it("busca por palavras, sem acento e com um erro, da mais relevante à menos", async () => {
    setViewport(1280);
    render(<DataTable columns={itemColumns} rows={items} getRowId={(r) => r.id} search={{}} />);
    await userEvent.type(screen.getByRole("searchbox"), "caixa");
    expect(names()).toEqual(["Caixa 1", "Caixas da Loja"]);
    await userEvent.clear(screen.getByRole("searchbox"));
    await userEvent.type(screen.getByRole("searchbox"), "balcao dispositvo");
    expect(names()).toEqual(["Dispositivo do balcão"]);
  });

  it("a ordenação escolhida no cabeçalho prevalece sobre a relevância", async () => {
    setViewport(1280);
    render(<DataTable columns={itemColumns} rows={items} getRowId={(r) => r.id} search={{}} />);
    await userEvent.type(screen.getByRole("searchbox"), "caixa");
    await userEvent.click(screen.getByRole("columnheader", { name: "Nome" }));
    expect(names()).toEqual(["Caixa 1", "Caixas da Loja"].sort((a, b) => a.localeCompare(b, "pt-BR")));
    await userEvent.click(screen.getByRole("columnheader", { name: "Nome" }));
    expect(names()).toEqual(["Caixas da Loja", "Caixa 1"]);
  });
});

describe("tooltip do cabeçalho", () => {
  it("mostra a explicação da coluna ao passar o mouse sobre o rótulo", async () => {
    setViewport(1280);
    render(
      <DataTable
        columns={[{ ...defined(columns[0], "the first column"), tooltip: "Nome do registro." }]}
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
          { ...defined(columns[0], "the first column"), sortable: true, firstSort },
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
      .map((r) => defined(within(r).getAllByRole("cell")[0], "the first cell").textContent);

  it("imprime a coluna com o printValue", async () => {
    setViewport(1280);
    stubPrint();
    const columns = saleColumns.map((c, i) => (i === 0 ? { ...c, printValue: (r: (typeof sales)[number]) => `impresso ${r.seller}` } : c));
    render(<DataTable columns={columns} rows={sales} getRowId={(r) => r.id} title="Vendas" print={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "Imprimir" }));
    expect(printedSellers()[0]).toMatch(/^impresso /);
  });

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

  it("mantém o detalhe aberto ao clicar na célula (selecionar a linha)", async () => {
    setViewport(1280);
    render(<DataTable columns={comparedColumns} rows={sellers} getRowId={(r) => r.id} />);
    const cell = screen.getByRole("cell", { name: "12.340,00" });
    await userEvent.hover(cell);
    expect(await screen.findByText("▲ 12,2%")).toBeTruthy();

    // "Não fechou": avança o relógio simulado além de qualquer atraso de fechamento do tooltip.
    vi.useFakeTimers();
    try {
      fireEvent.click(cell);
      await vi.advanceTimersByTimeAsync(300);
      expect(screen.getByText("▲ 12,2%")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
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
    const footerRow = defined(within(screen.getByRole("table")).getAllByRole("row").at(-1), "the last row");
    const cells = within(footerRow).getAllByRole("cell");
    expect(cells.map((c) => c.textContent?.replace(/\u00a0/g, " "))).toEqual(["Total", "", "R$ 150,00"]);
  });

  it("recalcula o total pela função com as linhas da busca, de todas as páginas", async () => {
    setViewport(1280);
    const many: Seller[] = Array.from({ length: 5 }, (_, i) => ({ id: String(i), nome: i < 4 ? `Ana ${i}` : "Bia", qtd: 1, valor: 10 }));
    const totals = vi.fn((filtered: Seller[]) => ({ valor: filtered.reduce((sum, r) => sum + r.valor, 0) }));
    render(
      <DataTable
        columns={[{ ...defined(totalColumns[0], "the first column"), searchable: true }, ...totalColumns.slice(1)]}
        rows={many}
        getRowId={(r) => r.id}
        search={{ placeholder: "Buscar" }}
        pagination={{ pageSize: 2 }}
        totals={totals}
      />,
    );
    const lastCells = () => within(defined(within(screen.getByRole("table")).getAllByRole("row").at(-1), "the last row")).getAllByRole("cell");
    expect(defined(lastCells().at(-1), "the last cell").textContent?.replace(/\u00a0/g, " ")).toBe("R$ 50,00");

    await userEvent.type(screen.getByPlaceholderText("Buscar"), "Ana");
    expect(defined(lastCells().at(-1), "the last cell").textContent?.replace(/\u00a0/g, " ")).toBe("R$ 40,00");
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
    const cells = within(defined(within(printed).getAllByRole("row").at(-1), "the last row")).getAllByRole("cell");
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
    const cells = within(defined(within(screen.getByRole("table", { name: "Vendas" })).getAllByRole("row").at(-1), "the last row")).getAllByRole("cell");
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

describe("linha selecionada", () => {
  const data: Row[] = [
    { id: "1", name: "Alfa" },
    { id: "2", name: "Beta" },
  ];

  it("destaca a linha clicada, troca ao clicar em outra e desmarca ao clicar de novo", async () => {
    setViewport(1280);
    render(<DataTable rowCursor={false} columns={columns} rows={data} getRowId={(r) => r.id} />);
    const alfa = defined(screen.getByText("Alfa").closest("tr"), "the Alfa row");
    const beta = defined(screen.getByText("Beta").closest("tr"), "the Beta row");

    await userEvent.click(alfa);
    expect(alfa.getAttribute("aria-selected")).toBe("true");

    await userEvent.click(beta);
    expect(alfa.getAttribute("aria-selected")).toBe("false");
    expect(beta.getAttribute("aria-selected")).toBe("true");

    await userEvent.click(beta);
    expect(beta.getAttribute("aria-selected")).toBe("false");
  });

  it("tira o destaque ao clicar fora da tabela", async () => {
    setViewport(1280);
    render(
      <>
        <p>Fora</p>
        <DataTable rowCursor={false} columns={columns} rows={data} getRowId={(r) => r.id} />
      </>,
    );
    const alfa = defined(screen.getByText("Alfa").closest("tr"), "the Alfa row");
    await userEvent.click(alfa);
    expect(alfa.getAttribute("aria-selected")).toBe("true");
    await userEvent.click(screen.getByText("Fora"));
    expect(alfa.getAttribute("aria-selected")).toBe("false");
  });

  it("não seleciona a linha ao clicar numa ação dela", async () => {
    setViewport(1280);
    render(
      <DataTable
        rowCursor={false}
        columns={columns}
        rows={data}
        getRowId={(r) => r.id}
        rowActions={(r) => <button type="button">Editar {r.name}</button>}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Editar Alfa" }));
    expect(defined(screen.getByText("Alfa").closest("tr"), "the Alfa row").getAttribute("aria-selected")).toBe("false");
  });
});

describe("linha expansível no desktop", () => {
  it("expande e recolhe ao clicar em qualquer ponto da linha", async () => {
    setViewport(1280);
    renderTable();
    const cell = await screen.findByText("Alfa");
    await userEvent.click(cell);
    expect(screen.getByText("Detalhe de Alfa")).toBeTruthy();
    await userEvent.click(cell);
    expect(screen.queryByText("Detalhe de Alfa")).toBeNull();
  });
});

describe("tabela aninhada no celular", () => {
  it("a tabela da linha expandida perde a moldura própria, mas cada item continua um card", async () => {
    setViewport(500);
    render(
      <DataTable
        rowCursor={false}
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        defaultExpanded
        renderExpanded={() => (
          <DataTable columns={columns} rows={[{ id: "x", name: "Interno" }]} getRowId={(r) => r.id} />
        )}
      />,
    );
    const interno = await screen.findByText("Interno");
    const item = defined(interno.closest("[data-slot=card]"), "the inner card");
    expect(item.className).not.toContain("ring-0");
    const tabela = defined(item.parentElement?.closest("[data-slot=card]"), "the outer card");
    expect(tabela.className).toContain("ring-0");
    expect(tabela.className).toContain("overflow-visible");
  });
});

describe("DataTable arrowNavigation", () => {
  afterEach(cleanup);
  type Linha = { id: string; nome: string };
  const linhas: Linha[] = [
    { id: "1", nome: "Ana" },
    { id: "2", nome: "Bia" },
  ];
  const colunasEditaveis = [
    { key: "nome", label: "Nome", value: (r: Linha) => r.nome },
    { key: "a", label: "A", render: (r: Linha) => <input aria-label={`A ${r.nome}`} defaultValue="12" /> },
    {
      key: "b",
      label: "B",
      // Como um Switch do base-ui: a chave e o checkbox escondido ficam fora da navegação.
      render: (r: Linha) => (
        <>
          <button type="button" role="switch" aria-checked="false" aria-label={`Chave ${r.nome}`} />
          <input type="checkbox" aria-hidden="true" tabIndex={-1} />
          <input aria-label={`B ${r.nome}`} defaultValue="" />
        </>
      ),
    },
  ];

  it("move o foco entre os campos das células com as setas e o Enter, como numa planilha", () => {
    setViewport(1280);
    render(<DataTable columns={colunasEditaveis} rows={linhas} getRowId={(r) => r.id} />);
    const a1 = screen.getByLabelText("A Ana") as HTMLInputElement;
    a1.focus();
    fireEvent.keyDown(a1, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByLabelText("A Bia"));
    // A linha do campo com foco fica destacada, como se tivesse sido clicada.
    expect(screen.getByLabelText("A Bia").closest("tr")?.getAttribute("data-state")).toBe("selected");
    fireEvent.keyDown(defined(document.activeElement, "the focused element"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(a1);
    // ← e → só trocam de célula na ponta do texto; no meio, o cursor anda no texto.
    a1.setSelectionRange(1, 1);
    fireEvent.keyDown(a1, { key: "ArrowRight" });
    expect(document.activeElement).toBe(a1);
    a1.setSelectionRange(2, 2);
    fireEvent.keyDown(a1, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByLabelText("B Ana"));
    fireEvent.keyDown(defined(document.activeElement, "the focused element"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(a1);
    // Ao ganhar o foco, o valor fica todo selecionado: digitar substitui.
    expect([a1.selectionStart, a1.selectionEnd]).toEqual([0, 2]);
    fireEvent.keyDown(a1, { key: "ArrowRight" });
    fireEvent.keyDown(defined(document.activeElement, "the focused element"), { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByLabelText("B Bia"));
  });

  it("Esc desfaz o texto digitado e devolve o foco ao contêiner; Enter segue para a linha de baixo", () => {
    setViewport(1280);
    render(<DataTable columns={colunasEditaveis} rows={linhas} getRowId={(r) => r.id} />);
    const a1 = screen.getByLabelText("A Ana") as HTMLInputElement;
    a1.focus();
    fireEvent.change(a1, { target: { value: "zzz" } });
    fireEvent.keyDown(a1, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByLabelText("A Bia"));
    const b = screen.getByLabelText("A Bia") as HTMLInputElement;
    fireEvent.change(b, { target: { value: "yyy" } });
    fireEvent.keyDown(b, { key: "Escape" });
    expect(b.value).toBe(b.defaultValue);
    expect(document.activeElement).toBe(document.querySelector("[data-arrow-root]"));
  });

  it("o cursor de célula que chega a uma célula com campo de texto foca o campo", () => {
    setViewport(1280);
    render(<DataTable columns={colunasEditaveis} rows={linhas} getRowId={(r) => r.id} />);
    const root = defined(document.querySelector("[data-arrow-root]") as HTMLElement | null, "root");
    root.focus();
    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByLabelText("A Ana"));
    expect(document.querySelector("[data-active-cell]")?.getAttribute("data-col")).toBe("a");
  });

  it("chegar a uma célula com botões já foca o primeiro (o último, vindo da direita); ←/→ percorrem e saem; ↑/↓ mantêm a coluna; Enter ativa", () => {
    setViewport(1280);
    const editar = vi.fn();
    const cols = [
      { key: "nome", label: "Nome", value: (r: Linha) => r.nome },
      { key: "acoes", label: "Ações", render: (r: Linha) => (<><button type="button" onClick={() => editar(r.id)}>Editar {r.nome}</button><button type="button">Excluir {r.nome}</button></>) },
      { key: "fim", label: "Fim", value: () => "x" },
    ];
    render(<DataTable columns={cols} rows={linhas} getRowId={(r) => r.id} />);
    const root = defined(document.querySelector("[data-arrow-root]") as HTMLElement | null, "root");
    const ativa = () => document.querySelector("[data-active-cell]")?.getAttribute("data-col");
    root.focus();
    // Da esquerda: já cai no primeiro botão.
    fireEvent.keyDown(root, { key: "ArrowRight" });
    const editarAna = screen.getByText("Editar Ana");
    expect(document.activeElement).toBe(editarAna);
    expect(ativa()).toBe("acoes");
    fireEvent.keyDown(editarAna, { key: "ArrowRight" });
    const excluirAna = screen.getByText("Excluir Ana");
    expect(document.activeElement).toBe(excluirAna);
    fireEvent.keyDown(excluirAna, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(editarAna);
    // Enter ativa o controle focado.
    fireEvent.click(editarAna);
    expect(editar).toHaveBeenCalledWith("1");
    // ↓ mantém a coluna e foca o botão da linha de baixo.
    fireEvent.keyDown(editarAna, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByText("Editar Bia"));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(editarAna);
    // Depois do último, sai para a célula seguinte; voltando da direita, cai no último botão.
    fireEvent.keyDown(editarAna, { key: "ArrowRight" });
    fireEvent.keyDown(excluirAna, { key: "ArrowRight" });
    expect(document.activeElement).toBe(root);
    expect(ativa()).toBe("fim");
    fireEvent.keyDown(root, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(excluirAna);
    // Esc volta ao cursor de célula.
    fireEvent.keyDown(excluirAna, { key: "Escape" });
    expect(document.activeElement).toBe(root);
    expect(ativa()).toBe("acoes");
  });

  it("célula cortada mostra o texto inteiro no title ao passar o mouse; sem corte, não", () => {
    setViewport(1280);
    render(<DataTable columns={[{ key: "n", label: "Nome completo", value: (r: Linha) => r.nome }]} rows={linhas} getRowId={(r) => r.id} />);
    const td = defined(document.querySelector("td[data-col=n]") as HTMLElement | null, "td");
    const th = defined(document.querySelector("th") as HTMLElement | null, "th");
    fireEvent.mouseOver(td);
    expect(td.title).toBe("");
    Object.defineProperty(td, "scrollWidth", { configurable: true, value: 120 });
    Object.defineProperty(td, "clientWidth", { configurable: true, value: 60 });
    fireEvent.mouseOver(td);
    expect(td.title).toBe("Ana");
    Object.defineProperty(th, "scrollWidth", { configurable: true, value: 120 });
    Object.defineProperty(th, "clientWidth", { configurable: true, value: 60 });
    fireEvent.mouseOver(th);
    expect(th.title).toBe("Nome completo");
    Object.defineProperty(td, "scrollWidth", { configurable: true, value: 50 });
    fireEvent.mouseOver(td);
    expect(td.hasAttribute("title")).toBe(false);
  });

  it("checkbox sozinho na célula fica centralizado, com padding simétrico", () => {
    setViewport(1280);
    // biome-ignore lint/a11y/useSemanticElements: imita o Checkbox do base-ui (botão com role=checkbox).
    render(<DataTable columns={[{ key: "s", label: "", render: () => <button type="button" role="checkbox" aria-checked="false" aria-label="Marcar" /> }]} rows={linhas} getRowId={(r) => r.id} />);
    const td = defined(document.querySelector("td[data-col=s]") as HTMLElement | null, "td");
    expect(td.className).toContain("[&_[role=checkbox]:only-child]:mx-auto");
    expect(td.className).not.toMatch(/(^|\s)pr-0|:pr-0/);
  });

  it("pode ser desligada com arrowNavigation={false}", () => {
    setViewport(1280);
    render(<DataTable columns={colunasEditaveis} rows={linhas} getRowId={(r) => r.id} arrowNavigation={false} />);
    const a1 = screen.getByLabelText("A Ana") as HTMLInputElement;
    a1.focus();
    fireEvent.keyDown(a1, { key: "ArrowDown" });
    expect(document.activeElement).toBe(a1);
  });
});

describe("DataTable desempenho", () => {
  afterEach(cleanup);
  it("com coluna fixa, uma lista nova com as mesmas linhas não redesenha as que não mudaram", () => {
    setViewport(1280);
    let renders = 0;
    type L = { id: string; nome: string };
    const cols = [
      { key: "nome", label: "Nome", value: (r: L) => r.nome },
      { key: "x", label: "X", render: (r: L) => {
          renders++;
          return r.nome;
        } },
    ];
    const ana = { id: "1", nome: "Ana" };
    const bia = { id: "2", nome: "Bia" };
    const id = (r: L) => r.id;
    const { rerender } = render(<DataTable columns={cols} rows={[ana, bia]} getRowId={id} frozenUntil="nome" />);
    const antes = renders;
    rerender(<DataTable columns={cols} rows={[ana, { ...bia, nome: "Bianca" }]} getRowId={id} frozenUntil="nome" />);
    // Só a linha alterada redesenha.
    expect(renders - antes).toBe(1);
  });

  it("com o cursor (padrão) sempre há uma linha ativa: clicar move e clicar de novo mantém", async () => {
    setViewport(1280);
    const data: Row[] = [{ id: "1", name: "Alfa" }, { id: "2", name: "Beta" }];
    render(<DataTable columns={columns} rows={data} getRowId={(r) => r.id} />);
    const alfa = defined(screen.getByText("Alfa").closest("tr"), "the Alfa row");
    const beta = defined(screen.getByText("Beta").closest("tr"), "the Beta row");
    expect(alfa.getAttribute("aria-selected")).toBe("true");
    await userEvent.click(beta);
    expect(beta.getAttribute("aria-selected")).toBe("true");
    await userEvent.click(beta);
    expect(beta.getAttribute("aria-selected")).toBe("true");
    expect(alfa.getAttribute("aria-selected")).toBe("false");
  });
});

describe("DataTable cursor de linhas", () => {
  it("a primeira linha fica ativa, as setas a movem e o Espaço chama onRowToggle", () => {
    const toggled: string[] = [];
    const Harness = () => {
      const [ativo, setAtivo] = useState<string | null>(null);
      return <DataTable columns={[{ key: "n", label: "N", value: (r: { id: string }) => r.id }]} rows={[{ id: "a" }, { id: "b" }]} getRowId={(r) => r.id} activeRowId={ativo} onActiveRowChange={setAtivo} onRowToggle={(r) => toggled.push(r.id)} />;
    };
    render(<Harness />);
    const rows = () => screen.getAllByRole("row").slice(1);
    expect(rows()[0]?.getAttribute("aria-selected")).toBe("true");
    const root = document.querySelector("[data-arrow-root]") as HTMLElement;
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(rows()[1]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(root, { key: " " });
    expect(toggled).toEqual(["b"]);
  });

  it("por padrão, sem props de cursor, a tabela tem linha ativa, setas/Home/End movem e não rouba o foco", () => {
    setViewport(1280);
    const data = ["a", "b", "c"].map((id) => ({ id }));
    render(<DataTable columns={[{ key: "n", label: "N", value: (r: { id: string }) => r.id }]} rows={data} getRowId={(r) => r.id} />);
    const rowsEl = () => screen.getAllByRole("row").slice(1);
    const root = defined(document.querySelector("[data-arrow-root]") as HTMLElement | null, "the table root");
    expect(root.tabIndex).toBe(0);
    expect(document.activeElement).not.toBe(root);
    expect(rowsEl()[0]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(rowsEl()[1]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(root, { key: "End", ctrlKey: true });
    expect(rowsEl()[2]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(root, { key: "PageUp" });
    expect(rowsEl()[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("rowCursor={false} desliga o cursor", () => {
    setViewport(1280);
    render(<DataTable rowCursor={false} columns={[{ key: "n", label: "N", value: (r: { id: string }) => r.id }]} rows={[{ id: "a" }]} getRowId={(r) => r.id} />);
    expect(screen.getAllByRole("row")[1]?.getAttribute("aria-selected")).toBe("false");
  });

  it("cursor 2D: setas laterais movem a célula ativa, Home/End e Ctrl+Home/End, só a célula tem contorno", () => {
    setViewport(1280);
    const data = ["a", "b"].map((id) => ({ id }));
    const cols = [
      { key: "x", label: "X", value: (r: { id: string }) => r.id },
      { key: "y", label: "Y", value: (r: { id: string }) => r.id },
      { key: "z", label: "Z", value: (r: { id: string }) => r.id },
    ];
    render(<DataTable columns={cols} rows={data} getRowId={(r) => r.id} />);
    const root = defined(document.querySelector("[data-arrow-root]") as HTMLElement | null, "root");
    const active = () => Array.from(document.querySelectorAll("[data-active-cell]")).map((c) => `${c.parentElement?.getAttribute("data-row-id")}:${c.getAttribute("data-col")}`);
    expect(active()).toEqual(["a:x"]);
    fireEvent.keyDown(root, { key: "ArrowRight" });
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(active()).toEqual(["b:y"]);
    fireEvent.keyDown(root, { key: "End" });
    expect(active()).toEqual(["b:z"]);
    fireEvent.keyDown(root, { key: "Home" });
    expect(active()).toEqual(["b:x"]);
    fireEvent.keyDown(root, { key: "End", ctrlKey: true });
    expect(active()).toEqual(["b:z"]);
    fireEvent.keyDown(root, { key: "Home", ctrlKey: true });
    expect(active()).toEqual(["a:x"]);
    expect(root.className).not.toMatch(/ring|focus:outline-(?!none)/);
    // Anel de 2px por dentro; `data-[active-cell]` entre colchetes porque `data-active-cell:` é engolido pela variante `data-active` do shadcn.
    const cls = document.querySelector("[data-active-cell]")?.className ?? "";
    expect(cls).toContain("data-[active-cell]:inset-ring-2");
    expect(cls).toContain("group-focus-within/cur:data-[active-cell]:inset-ring-primary");
    expect(cls).not.toMatch(/(^|\s)data-active-cell:/);
  });

  it("rola na horizontal até a célula ativa, descontando a coluna fixa", () => {
    setViewport(1280);
    const cols = ["x", "y", "z"].map((k) => ({ key: k, label: k, value: (r: { id: string }) => r.id }));
    render(<DataTable columns={cols} rows={[{ id: "a" }]} getRowId={(r) => r.id} frozenUntil="x" />);
    const root = defined(document.querySelector("[data-arrow-root]") as HTMLElement | null, "root");
    const box = defined(root.querySelector("div[class*=overflow]") as HTMLElement | null, "scroll box");
    const rect = (l: number, r: number) => ({ left: l, right: r, top: 0, bottom: 0, width: r - l, height: 0, x: l, y: 0, toJSON: () => ({}) }) as DOMRect;
    box.getBoundingClientRect = () => rect(0, 300);
    const td = (k: string) => defined(document.querySelector(`td[data-col="${k}"]`) as HTMLElement | null, k);
    td("x").getBoundingClientRect = () => rect(0, 100);
    td("y").getBoundingClientRect = () => rect(50, 150);
    td("z").getBoundingClientRect = () => rect(280, 380);
    fireEvent.keyDown(root, { key: "ArrowRight" });
    // Com a folga de 10px: coluna fixa (100) + 10 - 50.
    expect(box.scrollLeft).toBe(-60);
    box.scrollLeft = 0;
    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(box.scrollLeft).toBe(90);
  });

  it("a rolagem do teclado desconta a barra vertical e vai até o fim real na última coluna", () => {
    setViewport(1280);
    const cols = ["x", "y"].map((k) => ({ key: k, label: k, value: (r: { id: string }) => r.id }));
    render(<DataTable columns={cols} rows={[{ id: "a" }]} getRowId={(r) => r.id} />);
    const root = defined(document.querySelector("[data-arrow-root]") as HTMLElement | null, "root");
    const box = defined(root.querySelector("div[class*=overflow]") as HTMLElement | null, "scroll box");
    const rect = (l: number, r: number) => ({ left: l, right: r, top: 0, bottom: 0, width: r - l, height: 0, x: l, y: 0, toJSON: () => ({}) }) as DOMRect;
    box.getBoundingClientRect = () => rect(0, 300);
    Object.defineProperty(box, "offsetWidth", { configurable: true, value: 300 });
    Object.defineProperty(box, "clientWidth", { configurable: true, value: 285 }); // barra de 15px
    Object.defineProperty(box, "scrollWidth", { configurable: true, value: 500 });
    defined(document.querySelector('td[data-col="y"]') as HTMLElement | null, "y").getBoundingClientRect = () => rect(200, 295);
    fireEvent.keyDown(root, { key: "ArrowRight" });
    // Fim real da rolagem (500 - 285), maior que o necessário pela conta da borda (295 - (300 - 15 - 10)).
    expect(box.scrollLeft).toBe(215);
  });

  it("a rolagem vertical do teclado desconta o cabeçalho e a barra horizontal e vai até a última linha", () => {
    setViewport(1280);
    const data = ["a", "b", "c"].map((id) => ({ id }));
    render(<DataTable columns={[{ key: "n", label: "N", value: (r: { id: string }) => r.id }]} rows={data} getRowId={(r) => r.id} />);
    const root = defined(document.querySelector("[data-arrow-root]") as HTMLElement | null, "root");
    const box = defined(root.querySelector("div[class*=overflow]") as HTMLElement | null, "scroll box");
    const r = (t: number, b: number) => ({ left: 0, right: 0, top: t, bottom: b, width: 0, height: b - t, x: 0, y: t, toJSON: () => ({}) }) as DOMRect;
    box.getBoundingClientRect = () => r(0, 200);
    defined(box.querySelector("thead") as HTMLElement | null, "thead").getBoundingClientRect = () => r(0, 30);
    Object.defineProperty(box, "offsetHeight", { configurable: true, value: 200 });
    Object.defineProperty(box, "clientHeight", { configurable: true, value: 185 }); // barra de 15px
    Object.defineProperty(box, "scrollHeight", { configurable: true, value: 300 });
    const tr = (id: string) => defined(document.querySelector(`tr[data-row-id="${id}"]`) as HTMLElement | null, id);
    tr("b").getBoundingClientRect = () => r(160, 190); // passa de 200 - 15 - 10 = 175
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(box.scrollTop).toBe(15);
    tr("c").getBoundingClientRect = () => r(170, 200);
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(box.scrollTop).toBe(115); // última linha: fim real (300 - 185)
  });

  it("mover o cursor só redesenha as duas linhas afetadas, não a tabela inteira", () => {
    setViewport(1280);
    const data = Array.from({ length: 50 }, (_, i) => ({ id: String(i) }));
    let renders = 0;
    const cols = [{ key: "n", label: "N", render: (r: { id: string }) => { renders++; return r.id; } }];
    const getId = (r: { id: string }) => r.id;
    function Cursor() {
      const [ativo, setAtivo] = useState<string | null>("0");
      return <DataTable columns={cols} rows={data} getRowId={getId} activeRowId={ativo} onActiveRowChange={setAtivo} />;
    }
    render(<Cursor />);
    const root = defined(document.querySelector("[tabindex]") as HTMLElement | null, "the table root");
    renders = 0;
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(renders).toBeLessThanOrEqual(4);
  });
});

describe("DataTable truncateAt", () => {
  it("limita a largura da célula e expõe o valor completo em title", () => {
    const nome = "ABS SEMPRE LIVRE ADAPT PLUS SUAVE SEM ABAS 16UNID";
    const rows = [{ id: "1", nome }];
    render(<DataTable columns={[{ key: "nome", label: "Produto", value: (r: { nome: string }) => r.nome, truncateAt: 20 }]} rows={rows} getRowId={(r) => r.id} />);
    const cell = screen.getByTitle(nome);
    expect(cell.style.maxWidth).toBe("20ch");
  });
});

describe("DataTable colunas redimensionáveis", () => {
  const rows = [{ id: "1", nome: "A", qtd: 1 }];
  const cols = [
    { key: "nome", label: "Produto", value: (r: { nome: string }) => r.nome, sortable: true },
    { key: "qtd", label: "Qtd", value: (r: { qtd: number }) => r.qtd, resizable: false },
  ];
  const tabela = (extra?: { resizableColumns?: boolean; resizeKey?: string }) => (
    <DataTable columns={cols} rows={rows} getRowId={(r) => r.id} {...extra} />
  );

  it("arrastar a alça define a largura (mínimo 60px), duplo clique restaura e a coluna com resizable false não tem alça", () => {
    const { container } = render(tabela());
    expect(document.querySelector("[data-resize-handle=qtd]")).toBeNull();
    const handle = defined(document.querySelector<HTMLElement>("[data-resize-handle=nome]"), "the handle");
    const card = defined(container.querySelector<HTMLElement>("[data-slot=card]"), "the card");
    fireEvent.pointerDown(handle, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 400 });
    fireEvent.pointerUp(window);
    expect(card.style.getPropertyValue("--cw-nome")).toMatch(/^\d+px$/);
    expect(Number.parseInt(card.style.getPropertyValue("--cw-nome"), 10)).toBeGreaterThanOrEqual(60);
    fireEvent.doubleClick(handle);
    expect(card.style.getPropertyValue("--cw-nome")).toBe("");
  });

  it("clicar na alça não ordena a coluna", () => {
    render(tabela());
    fireEvent.click(defined(document.querySelector<HTMLElement>("[data-resize-handle=nome]"), "the handle"));
    expect(screen.getByRole("columnheader", { name: /Produto/ }).getAttribute("aria-sort")).toBeNull();
  });

  it("resizableColumns false remove todas as alças; resizeKey lembra a largura", () => {
    const { unmount } = render(tabela({ resizableColumns: false }));
    expect(document.querySelectorAll("[data-resize-handle]")).toHaveLength(0);
    unmount();
    localStorage.setItem("celestia:datatable-widths:t", JSON.stringify({ nome: 222 }));
    const { container } = render(tabela({ resizeKey: "t" }));
    expect(defined(container.querySelector<HTMLElement>("[data-slot=card]"), "the card").style.getPropertyValue("--cw-nome")).toBe("222px");
    localStorage.clear();
  });
});
