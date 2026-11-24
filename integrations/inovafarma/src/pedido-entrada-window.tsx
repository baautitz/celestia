import { useEffect, useMemo, useState } from "react";
import { Building2, Package } from "lucide-react";
import { Stack, Text } from "@platform/ui/components/layout";
import { ToggleGroup, ToggleGroupItem } from "@platform/ui/components/toggle-group";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { usePreference } from "@platform/ui/hooks/use-preference";
import type { LojaOpcao } from "./loja-opcao";
import { PEDIDOS_BASE } from "./pedido-rascunho-window";

type Visao = "produto" | "distribuidora";
type Estado = "pendente" | "parcial" | "recebido" | "excedente";
interface Linha { produtoId: string; codigoProduto: number | null; nome: string; codigoLoja: number; pedida: number; recebida: number; estado: Estado; codigoFornecedor: number; fornecedor: string }
interface Grupo { id: string; titulo: string; codigo: number | null; linhas: Linha[] }

const ESTADOS: Record<Estado, string> = { pendente: "Pendente", parcial: "Parcial", recebido: "Recebido", excedente: "Excedente" };
const ok = (l: Linha) => l.estado === "recebido" || l.estado === "excedente";
const aceita = (v: unknown): v is Visao => v === "produto" || v === "distribuidora";

/** Agrupa as linhas por produto ou por distribuidora; `ok` é o contador de itens com todas as linhas recebidas. */
function agrupar(linhas: Linha[], visao: Visao): Grupo[] {
  const porChave = new Map<string, Grupo>();
  for (const l of linhas) {
    const id = visao === "produto" ? l.produtoId : String(l.codigoFornecedor);
    const g = porChave.get(id) ?? { id, titulo: visao === "produto" ? l.nome : l.fornecedor, codigo: visao === "produto" ? l.codigoProduto : null, linhas: [] };
    g.linhas.push(l);
    porChave.set(id, g);
  }
  return [...porChave.values()];
}

/** Acompanhamento da entrada das NFs de um Pedido confirmado, agrupado por produto ou por distribuidora. */
export function EntradaWindow({ pedidoId, lojas }: { pedidoId: string; lojas: LojaOpcao[] }) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [visao, salvarVisao] = usePreference<Visao>("inovafarma:pedido-entrada:view", "produto", aceita);
  const nomeLoja = (codigo: number) => lojas.find((l) => l.codigo === codigo)?.nome ?? `Loja ${codigo}`;

  useEffect(() => {
    apiFetch<{ linhas: Linha[] }>(`${PEDIDOS_BASE}/${pedidoId}/recebimento`)
      .then((r) => setLinhas(r.linhas))
      .catch((err: unknown) => setFalha(err instanceof Error ? err.message : "Erro ao carregar a entrada."));
  }, [pedidoId]);

  const grupos = useMemo(() => agrupar(linhas ?? [], visao), [linhas, visao]);

  if (falha) return <Text tone="muted">{falha}</Text>;
  if (!linhas) return <Text tone="muted">Carregando a entrada...</Text>;

  const contador = (g: Grupo) => {
    const itens = visao === "produto" ? [g.linhas] : [...g.linhas.reduce((m, l) => m.set(l.produtoId, [...(m.get(l.produtoId) ?? []), l]), new Map<string, Linha[]>()).values()];
    return `${itens.filter((i) => i.every(ok)).length}/${itens.length}`;
  };
  const colunasGrupo: DataTableColumn<Grupo>[] = [
    ...(visao === "produto" ? [{ key: "codigo", label: "Código", value: (g: Grupo) => g.codigo ?? "", searchable: true, sortable: true, cellClassName: "font-mono text-xs" } satisfies DataTableColumn<Grupo>] : []),
    { key: "titulo", label: visao === "produto" ? "Produto" : "Distribuidora", value: (g) => g.titulo, searchable: true, sortable: true, mobileRole: "primary" },
    { key: "ok", label: visao === "produto" ? "Lojas ok" : "Produtos ok", value: contador },
    { key: "pedida", label: "Pedida", format: "decimal", value: (g) => g.linhas.reduce((n, l) => n + l.pedida, 0) },
    { key: "recebida", label: "Recebida", format: "decimal", value: (g) => g.linhas.reduce((n, l) => n + l.recebida, 0) },
  ];
  const colunasLinha: DataTableColumn<Linha>[] = [
    ...(visao === "distribuidora" ? [{ key: "codigo", label: "Código", value: (l: Linha) => l.codigoProduto ?? "", cellClassName: "font-mono text-xs" } satisfies DataTableColumn<Linha>, { key: "nome", label: "Produto", value: (l: Linha) => l.nome } satisfies DataTableColumn<Linha>] : [{ key: "fornecedor", label: "Distribuidora", value: (l: Linha) => l.fornecedor } satisfies DataTableColumn<Linha>]),
    { key: "loja", label: "Loja", value: (l) => nomeLoja(l.codigoLoja) },
    { key: "pedida", label: "Pedida", format: "decimal", value: (l) => l.pedida },
    { key: "recebida", label: "Recebida", format: "decimal", value: (l) => l.recebida },
    { key: "estado", label: "Situação", value: (l) => ESTADOS[l.estado] },
  ];

  return (
    <>
      <Stack gap="section">
        <ToggleGroup variant="outline" spacing={0} aria-label="Agrupar entrada" value={[visao]} onValueChange={(v: string[]) => { if (aceita(v[0])) salvarVisao(v[0]); }}>
          <ToggleGroupItem value="produto" aria-label="Por produto"><Package />Por produto</ToggleGroupItem>
          <ToggleGroupItem value="distribuidora" aria-label="Por distribuidora"><Building2 />Por distribuidora</ToggleGroupItem>
        </ToggleGroup>
        <DataTable
          scroll="page"
          columns={colunasGrupo}
          rows={grupos}
          getRowId={(g) => g.id}
          emptyMessage="Nenhum produto com distribuidora escolhida no Pedido."
          search={{ placeholder: visao === "produto" ? "Buscar produto" : "Buscar distribuidora", fields: (g) => g.linhas.map((l) => l.nome) }}
          renderExpanded={(g) => <DataTable scroll="page" columns={colunasLinha} rows={g.linhas} getRowId={(l) => `${l.produtoId}|${l.codigoLoja}`} />}
        />
      </Stack>
      <WindowActions>
        <WindowCancelButton>Fechar</WindowCancelButton>
      </WindowActions>
    </>
  );
}
