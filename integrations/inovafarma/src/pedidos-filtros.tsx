import { useState } from "react";
import { Button } from "@platform/ui/components/button";
import { Checkbox } from "@platform/ui/components/checkbox";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@platform/ui/components/combobox";
import { DateRangePicker } from "@platform/ui/components/date-range-picker";
import { Label } from "@platform/ui/components/label";
import { Grid, Stack } from "@platform/ui/components/layout";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { ListaProdutosCampo } from "./lista-produtos-campo";
import type { LojaOpcao } from "./loja-opcao";
import type { Pedido } from "./pedido-rascunho-window";
import { FiltroLojas } from "./pedidos-lancamento-tab";
import type { EntradaLista } from "./tipos-meta";

export interface FiltrosPedidos {
  /** Dias `AAAA-MM-DD` de criação; null sem filtro. */
  periodo: { de: string; ate: string } | null;
  situacoes: Pedido["status"][];
  /** Lojas de destino. */
  lojas: number[];
  /** Código da distribuidora, ou o negativo do código da Loja fornecedora. */
  fornecedor: number | null;
  entradas: EntradaLista[];
}

export const SEM_FILTROS: FiltrosPedidos = { periodo: null, situacoes: [], lojas: [], fornecedor: null, entradas: [] };

export interface OpcaoFornecedor {
  codigo: number;
  nome: string;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const data = (v: string) => new Date(`${v}T00:00:00`);

const fornecedoresDoPedido = (p: Pedido) =>
  p.itens.flatMap((i) => [
    ...i.quantidades.flatMap((q) => [...(q.codigosFornecedor ?? []), ...(q.lojasFornecedoras ?? []).map((l) => -l.codigoLoja)]),
    ...[p.escolhas?.[i.produtoId] ?? []].flat().map((e) => (typeof e === "number" ? e : e.codigoFornecedor)),
  ]);

/** Os filtros combinam entre si; `produtos` são os `produtoId` que passam no filtro de produtos (null enquanto não há). */
export function filtrarPedidos(pedidos: Pedido[], f: FiltrosPedidos, produtos: ReadonlySet<string> | null): Pedido[] {
  return pedidos.filter((p) => {
    const dia = iso(new Date(p.criadoEm));
    if (f.periodo && (dia < f.periodo.de || dia > f.periodo.ate)) return false;
    if (f.situacoes.length && !f.situacoes.includes(p.status)) return false;
    if (f.lojas.length && !p.itens.some((i) => i.quantidades.some((q) => q.quantidade > 0 && f.lojas.includes(q.codigoLoja)))) return false;
    if (f.fornecedor !== null && !fornecedoresDoPedido(p).includes(f.fornecedor)) return false;
    return !f.entradas.length || p.itens.some((i) => produtos?.has(i.produtoId));
  });
}

export const resumoDosFiltros = (f: FiltrosPedidos, situacoes: Record<Pedido["status"], string>, fornecedores: OpcaoFornecedor[]) =>
  [
    f.periodo ? `Criados de ${data(f.periodo.de).toLocaleDateString("pt-BR")} a ${data(f.periodo.ate).toLocaleDateString("pt-BR")}` : null,
    f.situacoes.length ? f.situacoes.map((s) => situacoes[s]).join(", ") : null,
    f.lojas.length ? `${f.lojas.length} ${f.lojas.length === 1 ? "Loja" : "Lojas"}` : null,
    f.fornecedor !== null ? (fornecedores.find((x) => x.codigo === f.fornecedor)?.nome ?? "Fornecedor") : null,
    f.entradas.length ? "Filtro de produtos" : null,
  ]
    .filter(Boolean)
    .join(" · ");

/** Corpo do sheet "Filtros" da aba Pedidos: edita um rascunho e só devolve em "Filtrar". */
export function PedidosFiltrosSheet({ inicial, situacoes, lojas, fornecedores }: { inicial: FiltrosPedidos; situacoes: Record<Pedido["status"], string>; lojas: LojaOpcao[]; fornecedores: OpcaoFornecedor[] }) {
  const { resolve } = useWindow<FiltrosPedidos>();
  const [f, setF] = useState(inicial);
  const editar = (parte: Partial<FiltrosPedidos>) => setF((atual) => ({ ...atual, ...parte }));

  return (
    <Stack gap="section">
      <Stack gap="field">
        <Label>Criado em</Label>
        <DateRangePicker
          value={f.periodo ? { from: data(f.periodo.de), to: data(f.periodo.ate) } : undefined}
          onChange={(r) => editar({ periodo: r?.from && r.to ? { de: iso(r.from), ate: iso(r.to) } : null })}
        />
      </Stack>
      <Stack gap="field">
        <Label>Situação</Label>
        <Grid columns="split" gap="field">
          {(Object.keys(situacoes) as Pedido["status"][]).map((s) => (
            <Stack key={s} direction="row" gap="field" align="center">
              <Checkbox
                id={`pedidos-situacao-${s}`}
                checked={f.situacoes.includes(s)}
                onCheckedChange={(v: boolean) => editar({ situacoes: v ? [...f.situacoes, s] : f.situacoes.filter((x) => x !== s) })}
              />
              <Label htmlFor={`pedidos-situacao-${s}`}>{situacoes[s]}</Label>
            </Stack>
          ))}
        </Grid>
      </Stack>
      <FiltroLojas lojas={lojas} escolhidas={f.lojas} onChange={(l) => editar({ lojas: l })} />
      <Stack gap="field">
        <Label htmlFor="pedidos-fornecedor">Fornecedor</Label>
        <Combobox
          autoHighlight
          items={fornecedores}
          value={fornecedores.find((x) => x.codigo === f.fornecedor) ?? null}
          onValueChange={(x: OpcaoFornecedor | null) => editar({ fornecedor: x?.codigo ?? null })}
          itemToStringLabel={(x: OpcaoFornecedor) => x.nome}
          itemToStringValue={(x: OpcaoFornecedor) => String(x.codigo)}
          isItemEqualToValue={(a: OpcaoFornecedor, b: OpcaoFornecedor) => a.codigo === b.codigo}
        >
          <ComboboxInput id="pedidos-fornecedor" showClear placeholder="Todos os fornecedores" />
          <ComboboxContent>
            <ComboboxEmpty>Nenhum fornecedor encontrado.</ComboboxEmpty>
            <ComboboxList>
              {(x: OpcaoFornecedor) => (
                <ComboboxItem key={x.codigo} value={x}>
                  {x.nome}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Stack>
      <ListaProdutosCampo rotulo="Filtro de produtos" entradas={f.entradas} onChange={(entradas) => editar({ entradas })} />
      <WindowActions>
        <WindowCancelButton />
        <Button type="button" variant="outline" onClick={() => resolve(SEM_FILTROS)}>
          Limpar filtros
        </Button>
        <Button type="button" onClick={() => resolve(f)}>
          Filtrar
        </Button>
      </WindowActions>
    </Stack>
  );
}
