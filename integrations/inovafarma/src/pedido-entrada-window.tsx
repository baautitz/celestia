import { useEffect, useMemo, useState } from "react";
import { Building2, Package } from "lucide-react";
import { Grid, Stack, Text } from "@platform/ui/components/layout";
import { Tabs, TabsList, TabsTrigger } from "@platform/ui/components/tabs";
import { usePreference } from "@platform/ui/hooks/use-preference";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import type { LojaOpcao } from "./loja-opcao";
import { PEDIDOS_BASE } from "./pedido-rascunho-window";

type Visao = "produto" | "distribuidora";
type Estado = "pendente" | "parcial" | "recebido" | "excedente";
interface Linha { produtoId: string; codigoProduto: number | null; nome: string; codigoLoja: number; pedida: number; recebida: number; estado: Estado; codigoFornecedor: number; fornecedor: string; /** O que a Loja de destino pediu já chegou, somando todas as origens. */ lojaOk?: boolean }
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

/** Acompanhamento da entrada de um Pedido confirmado, no desenho do Gerar pedido: produtos, as Lojas do produto em foco e, embaixo, os fornecedores. */
export function EntradaWindow({ pedidoId, lojas }: { pedidoId: string; lojas: LojaOpcao[] }) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const nomeLoja = (codigo: number) => lojas.find((l) => l.codigo === codigo)?.nome ?? `Loja ${codigo}`;

  useEffect(() => {
    apiFetch<{ linhas: Linha[] }>(`${PEDIDOS_BASE}/${pedidoId}/recebimento`)
      .then((r) => setLinhas(r.linhas))
      .catch((err: unknown) => setFalha(err instanceof Error ? err.message : "Erro ao carregar a entrada."));
  }, [pedidoId]);

  const [visaoAtual, salvarVisao] = usePreference<Visao>("inovafarma:pedido-entrada:view", "produto", aceita);
  const [ativo, setAtivo] = useState<string | null>(null);
  const [fornAtivo, setFornAtivo] = useState<string | null>(null);
  const [produtoDoForn, setProdutoDoForn] = useState<string | null>(null);
  const porProduto = useMemo(() => agrupar(linhas ?? [], "produto"), [linhas]);
  const porFornecedor = useMemo(() => agrupar(linhas ?? [], "distribuidora"), [linhas]);

  if (falha) return <Text tone="muted">{falha}</Text>;
  if (!linhas) return <Text tone="muted">Carregando a entrada...</Text>;

  const contador = (g: Grupo, visao: Visao) => {
    // Por produto conta Lojas (completas somando as origens); por fornecedor, os produtos que ele já entregou inteiros.
    const itens = [...g.linhas.reduce((m, l) => m.set(visao === "produto" ? String(l.codigoLoja) : l.produtoId, [...(m.get(visao === "produto" ? String(l.codigoLoja) : l.produtoId) ?? []), l]), new Map<string, Linha[]>()).values()];
    return `${itens.filter((i) => i.every((l) => (visao === "produto" ? (l.lojaOk ?? ok(l)) : ok(l)))).length}/${itens.length}`;
  };
  const colunasGrupo = (visao: Visao): DataTableColumn<Grupo>[] => [
    ...(visao === "produto" ? [{ key: "codigo", label: "Código", value: (g: Grupo) => g.codigo ?? "", searchable: true, sortable: true, cellClassName: "font-mono text-xs" } satisfies DataTableColumn<Grupo>] : []),
    { key: "titulo", label: visao === "produto" ? "Produto" : "Fornecedor", value: (g) => g.titulo, searchable: true, sortable: true, mobileRole: "primary" },
    { key: "ok", label: visao === "produto" ? "Lojas ok" : "Produtos ok", value: (g) => contador(g, visao) },
    { key: "pedida", label: "Pedida", format: "decimal", value: (g) => g.linhas.reduce((n, l) => n + l.pedida, 0) },
    { key: "recebida", label: "Recebida", format: "decimal", value: (g) => g.linhas.reduce((n, l) => n + l.recebida, 0) },
  ];
  const colunasLinha = (visao: Visao): DataTableColumn<Linha>[] => [
    ...(visao === "distribuidora" ? [{ key: "codigo", label: "Código", value: (l: Linha) => l.codigoProduto ?? "", cellClassName: "font-mono text-xs" } satisfies DataTableColumn<Linha>, { key: "nome", label: "Produto", value: (l: Linha) => l.nome } satisfies DataTableColumn<Linha>] : [{ key: "fornecedor", label: "Fornecedor", value: (l: Linha) => l.fornecedor } satisfies DataTableColumn<Linha>]),
    { key: "loja", label: "Loja", value: (l) => nomeLoja(l.codigoLoja) },
    { key: "pedida", label: "Pedida", format: "decimal", value: (l) => l.pedida },
    { key: "recebida", label: "Recebida", format: "decimal", value: (l) => l.recebida },
    { key: "estado", label: "Situação", value: (l) => ESTADOS[l.estado] },
  ];

  const porVisaoDeProduto = visaoAtual === "produto";
  const fornEmFoco = porFornecedor.find((g) => g.id === fornAtivo) ?? porFornecedor[0];
  // Por fornecedor, a lista de baixo é o que foi pedido a ele; o produto em foco sai dela.
  const doFornecedor = agrupar(fornEmFoco?.linhas ?? [], "produto");
  const lista = porVisaoDeProduto ? porProduto : doFornecedor;
  const emFoco = lista.find((g) => g.id === (porVisaoDeProduto ? ativo : produtoDoForn)) ?? lista[0];

  return (
    <>
      <Stack gap="field" viewport="modal">
        <Tabs value={visaoAtual} onValueChange={(v) => { if (aceita(v)) salvarVisao(v); }}>
          <TabsList aria-label="Agrupar entrada">
            <TabsTrigger value="produto" aria-label="Por produto"><Package />Por produto</TabsTrigger>
            <TabsTrigger value="distribuidora" aria-label="Por fornecedor"><Building2 />Por fornecedor</TabsTrigger>
          </TabsList>
        </Tabs>
        <Grid key={visaoAtual} columns="workspace" gap="tight">
          <Stack grow>
            {porVisaoDeProduto ? (
              <DataTable scroll="fill" title="Produtos" columns={colunasGrupo("produto")} rows={porProduto} getRowId={(g) => g.id} activeRowId={emFoco?.id ?? null} onActiveRowChange={setAtivo} emptyMessage="Nenhum produto com fornecedor escolhido no Pedido." search={{ placeholder: "Buscar produto" }} />
            ) : (
              <DataTable scroll="fill" title="Fornecedores" columns={colunasGrupo("distribuidora")} rows={porFornecedor} getRowId={(g) => g.id} activeRowId={fornEmFoco?.id ?? null} onActiveRowChange={setFornAtivo} emptyMessage="Nenhum fornecedor." search={{ placeholder: "Buscar fornecedor" }} />
            )}
          </Stack>
          <Stack grow>
            <DataTable scroll="fill" title={emFoco ? `Lojas: ${emFoco.titulo}` : "Lojas"} columns={colunasLinha("produto")} rows={emFoco?.linhas ?? []} getRowId={(l) => `${l.codigoLoja}|${l.codigoFornecedor}`} emptyMessage="Nenhuma Loja." />
          </Stack>
          <Stack span="full" scroll="clip">
            {porVisaoDeProduto ? (
              <DataTable scroll="fill" title="Fornecedores" columns={colunasGrupo("distribuidora")} rows={porFornecedor} getRowId={(g) => g.id} emptyMessage="Nenhum fornecedor." />
            ) : (
              <DataTable scroll="fill" title={fornEmFoco ? `Produtos: ${fornEmFoco.titulo}` : "Produtos"} columns={colunasGrupo("produto")} rows={doFornecedor} getRowId={(g) => g.id} activeRowId={emFoco?.id ?? null} onActiveRowChange={setProdutoDoForn} emptyMessage="Nenhum produto." />
            )}
          </Stack>
        </Grid>
      </Stack>
      <WindowActions>
        <WindowCancelButton>Fechar</WindowCancelButton>
      </WindowActions>
    </>
  );
}
