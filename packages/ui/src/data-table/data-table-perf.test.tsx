// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { useMemo, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DataTable, type DataTableColumn } from "./data-table";

type P = { id: string; nome: string; a: number; b: number; c: number; d: number; e: number; cod: string };
const N = 4000;
const produtos: P[] = Array.from({ length: N }, (_, i) => ({ id: `p${i}`, nome: `Produto ${i}`, a: i, b: i * 2, c: i % 7, d: i % 13, e: i % 5, cod: `789${i}` }));
const idP = (p: P) => p.id;
const renders = { cells: 0 };

function Harness() {
  const [ativo, setAtivo] = useState<string | null>(null);
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set());
  const colunas = useMemo<DataTableColumn<P>[]>(() => [
    { key: "sel", label: "", render: (p) => { renders.cells++; return <input type="checkbox" aria-label={`Sel ${p.nome}`} readOnly checked={sel.has(p.id)} />; } },
    { key: "nome", label: "Produto", value: (p) => p.nome, searchable: true, sortable: true, truncateAt: 40 },
    { key: "a", label: "A", format: "decimal", value: (p) => p.a },
    { key: "b", label: "B", format: "decimal", value: (p) => p.b },
    { key: "c", label: "C", format: "decimal", value: (p) => p.c },
    { key: "d", label: "D", format: "decimal", value: (p) => p.d },
    { key: "e", label: "E", format: "decimal", value: (p) => p.e },
    { key: "cod", label: "Cod", value: (p) => p.cod, searchable: true },
  ], [sel]);
  return (
    <div style={{ height: 600 }}>
      <DataTable scroll="fill" compact title="Produtos" columns={colunas} rows={produtos} getRowId={idP} activeRowId={ativo} onActiveRowChange={setAtivo}
        onRowToggle={(p) => setSel((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} search={{ placeholder: "Buscar" }} />
    </div>
  );
}

const PERF = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.PERF;
afterEach(cleanup);

describe("DataTable com milhares de linhas", () => {
  it("setas e espaço não redesenham a tabela inteira", () => {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as typeof window.matchMedia;
    const t0 = performance.now();
    render(<Harness />);
    const mount = performance.now() - t0;
    const trs = document.querySelectorAll("tbody tr").length;
    const root = document.querySelector("[data-arrow-root]") as HTMLElement;
    root.focus();
    renders.cells = 0;
    const t1 = performance.now();
    for (let i = 0; i < 10; i++) fireEvent.keyDown(root, { key: "ArrowDown" });
    const arrow = (performance.now() - t1) / 10;
    const arrowRenders = renders.cells / 10;
    renders.cells = 0;
    const t2 = performance.now();
    for (let i = 0; i < 5; i++) fireEvent.keyDown(root, { key: " " });
    const space = (performance.now() - t2) / 5;
    const spaceRenders = renders.cells / 5;
    if (PERF) console.log(`[PERF] DOM rows=${trs} mount=${mount.toFixed(0)}ms ArrowDown=${arrow.toFixed(1)}ms (${arrowRenders} cell renders) Space=${space.toFixed(1)}ms (${spaceRenders} cell renders)`);
    expect(screen.getByText("Produtos")).toBeTruthy();
    expect(trs).toBeLessThan(300);
    expect(arrowRenders).toBeLessThan(10);
    expect(spaceRenders).toBeLessThan(100);
  }, 60000);

  it("o cursor segue para linhas fora da janela e a rolagem renderiza as novas", () => {
    render(<Harness />);
    const root = document.querySelector("[data-arrow-root]") as HTMLElement;
    const box = document.querySelector("[data-slot=table-container]") as HTMLElement;
    root.focus();
    for (let i = 0; i < 60; i++) fireEvent.keyDown(root, { key: "ArrowDown" });
    const ativa = document.querySelector("tr[data-state=selected]");
    expect(ativa?.getAttribute("data-row-id")).toBe("p60");
    expect(box.scrollTop).toBeGreaterThan(0);
    box.scrollTop = 29 * 2000;
    fireEvent.scroll(box);
    expect(document.querySelector('tr[data-row-id="p2005"]')).toBeTruthy();
    expect(document.querySelector('tr[data-row-id="p5"]')).toBeNull();
  });
});

describe("DataTable virtualizada: larguras estáveis", () => {
  it("rolar a janela não muda as larguras aplicadas às colunas", () => {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as typeof window.matchMedia;
    // Geometria simulada: o cabeçalho mede 100px; um texto (sonda) mede 8px por caractere.
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const width = this.tagName === "TH" ? 100 : this.tagName === "DIV" && this.style.visibility === "hidden" ? (this.textContent?.length ?? 0) * 8 : 0;
      return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };
    try {
      const rows = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, nome: i === 450 ? "UM NOME BEM MAIS LONGO DO QUE OS OUTROS" : `P${i}` }));
      render(<div style={{ height: 600 }}><DataTable scroll="fill" compact title="T" columns={[{ key: "nome", label: "Nome", value: (r: { nome: string }) => r.nome }]} rows={rows} getRowId={(r) => r.id} /></div>);
      const th = () => screen.getAllByRole("columnheader").find((h) => h.getAttribute("data-col") === "nome") as HTMLElement;
      const width = () => (th().closest('[data-slot="card"]') as HTMLElement).style.getPropertyValue("--cw-nome");
      const before = width();
      // A maior célula está fora da janela inicial, mas já conta na largura travada.
      const w = "UM NOME BEM MAIS LONGO DO QUE OS OUTROS".length * 8;
      expect(before).toBe(`${Math.ceil(w + 16 + Math.max(16, w * 0.08))}px`);
      const box = document.querySelector('[data-slot="table-container"]') as HTMLElement;
      for (const top of [5000, 12000, 14000]) {
        box.scrollTop = top;
        fireEvent.scroll(box);
        expect(width()).toBe(before);
      }
      expect(document.querySelector('[data-slot="table"]')?.className).toContain("table-fixed");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }
  });

  it("número formatado negativo longe da janela nunca é cortado: a largura o cobre e a coluna não tem reticências", () => {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as typeof window.matchMedia;
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const width = this.tagName === "TH" ? 40 : this.tagName === "DIV" && this.style.visibility === "hidden" ? (this.textContent?.length ?? 0) * 8 : 0;
      return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };
    try {
      const rows = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, v: i === 480 ? -1190.5 : i }));
      render(<div style={{ height: 600 }}><DataTable scroll="fill" compact title="T" columns={[{ key: "v", label: "V", format: "decimal" as const, value: (r: { v: number }) => r.v }]} rows={rows} getRowId={(r) => r.id} /></div>);
      const width = Number.parseFloat(((document.querySelector('[data-slot="card"]') as HTMLElement).style.getPropertyValue("--cw-v")));
      const texto = "-1.190,50";
      expect(width).toBeGreaterThanOrEqual(texto.length * 8 + 16 + 16);
      expect(document.querySelector("td[data-col=v]")?.className).not.toContain("text-ellipsis");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }
  });
});
