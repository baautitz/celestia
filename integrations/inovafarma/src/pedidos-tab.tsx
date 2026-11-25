import { useCallback, useEffect, useState } from "react";
import { Ban, ClipboardList, PackageCheck, Pencil, Scale } from "lucide-react";
import { Button } from "@platform/ui/components/button";
import { Stack } from "@platform/ui/components/layout";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { CotacaoWindow } from "./cotacao-window";
import { FalhaAoCarregar, useContexto } from "./contexto";
import { json } from "./inovafarma-api";
import type { LojaOpcao } from "./loja-opcao";
import { PEDIDOS_BASE, type Pedido } from "./pedido-rascunho-window";
import { EntradaWindow } from "./pedido-entrada-window";
import { PedidoLancamentoWindow } from "./pedidos-lancamento-tab";
import { useLatestFetch } from "./use-latest-fetch";
import { API } from "./inovafarma-api";

/** Situações em que o Pedido ainda pode ser editado. */
const EDITAVEIS: Pedido["status"][] = ["aguardando_precos", "cotado"];
const STATUS: Record<Pedido["status"], string> = { rascunho: "Rascunho", aguardando_precos: "Aguardando preços", cotado: "Cotado", confirmado: "Confirmado", parcialmente_recebido: "Parcialmente recebido", recebido: "Recebido", cancelado: "Cancelado" };
interface Recebimento { pedidoId: string; pedida: number; recebida: number; produtos: number; produtosOk: number }
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/** Aba Pedidos: a listagem dos Pedidos, com edição e cancelamento antes da confirmação. */
export function PedidosTab() {
  const { windows, feedback } = useUi();
  const novaConsulta = useLatestFetch();
  const { contexto } = useContexto<{ lojas: LojaOpcao[] }>(`${API}/pedidos/lancamento/contexto`, "Erro ao carregar as Lojas.");
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState<string | null>(null);
  const [entradas, setEntradas] = useState<Map<string, Recebimento>>(new Map());

  const carregar = useCallback(async () => {
    const vale = novaConsulta();
    setCarregando(true);
    try {
      const r = await apiFetch<Pedido[]>(PEDIDOS_BASE);
      if (vale()) {
        setPedidos(r);
        setFalha(null);
      }
      // A entrada vem do ERP: se ele falhar, a lista segue sem a coluna preenchida.
      const rec = await apiFetch<Recebimento[]>(`${PEDIDOS_BASE}/recebimentos`).catch(() => null);
      if (vale() && rec) setEntradas(new Map(rec.map((x) => [x.pedidoId, x])));
    } catch (err: unknown) {
      if (vale()) setFalha(err instanceof Error ? err.message : "Erro ao carregar os Pedidos.");
    } finally {
      if (vale()) setCarregando(false);
    }
  }, [novaConsulta]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const editar = async (pedido: Pedido) => {
    await windows.open<Pedido>({
      surface: "dialog",
      size: "screen",
      title: pedido.status === "rascunho" ? "Editar rascunho" : "Editar Pedido",
      description: `Pedido de ${dia(pedido.criadoEm)}`,
      content: () => <PedidoLancamentoWindow pedido={pedido} />,
    });
    void carregar();
  };

  const cotar = async (pedido: Pedido) => {
    // As distribuidoras já foram decididas no Lançamento: a cotação parte das que estão nas linhas do Pedido.
    const fornecedores = [...new Set(pedido.itens.flatMap((i) => i.quantidades.flatMap((q) => q.codigosFornecedor ?? [])))];
    if (fornecedores.length === 0) {
      feedback.notifyError(new Error("Escolha a distribuidora de ao menos uma Loja, pelo Editar, antes de cotar."));
      return;
    }
    try {
      await apiFetch(`${PEDIDOS_BASE}/${pedido.id}/cotacao`, json("POST", { fornecedores, version: pedido.version }));
      feedback.notify({ type: "success", title: "Cotação iniciada. Baixe a planilha de cada fornecedor." });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao iniciar a cotação."));
      return;
    }
    void carregar();
    await verCotacao(pedido);
  };

  const verCotacao = async (pedido: Pedido) => {
    await windows.open({
      surface: "dialog",
      size: "screen",
      title: "Cotação",
      description: `Pedido de ${dia(pedido.criadoEm)}`,
      content: () => <CotacaoWindow pedidoId={pedido.id} lojas={contexto?.lojas ?? []} />,
    });
    void carregar();
  };

  const verEntrada = async (pedido: Pedido) => {
    await windows.open({
      surface: "dialog",
      size: "screen",
      title: "Entrada do Pedido",
      description: `Pedido de ${dia(pedido.criadoEm)}`,
      content: () => <EntradaWindow pedidoId={pedido.id} lojas={contexto?.lojas ?? []} />,
    });
    void carregar();
  };

  const cancelar = async (pedido: Pedido) => {
    const ok = await windows.confirm({
      title: "Cancelar Pedido",
      description: `Cancelar o Pedido de ${dia(pedido.criadoEm)}? Um Pedido cancelado não pode mais ser editado nem cotado.`,
      confirmLabel: "Cancelar Pedido",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`${PEDIDOS_BASE}/${pedido.id}/cancelar`, json("POST", { version: pedido.version }));
      feedback.notify({ type: "success", title: "Pedido cancelado." });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao cancelar o Pedido."));
    }
    void carregar();
  };

  if (falha && pedidos.length === 0) return <FalhaAoCarregar titulo="Não foi possível carregar os Pedidos" descricao={falha} onTentarNovamente={() => void carregar()} />;

  const colunas: DataTableColumn<Pedido>[] = [
    { key: "criadoEm", label: "Criado em", format: "date", width: 120, value: (p) => p.criadoEm, sortable: true, firstSort: "desc" },
    { key: "criadoPor", label: "Criado por", value: (p) => p.criadoPorNome, searchable: true, mobileRole: "primary" },
    { key: "produtos", label: "Produtos", format: "decimal", width: 100, value: (p) => p.itens.length },
    { key: "status", label: "Situação", value: (p) => STATUS[p.status], searchable: true },
    {
      key: "entrada",
      format: "number",
      label: "Entrada",
      value: (p) => {
        const e = entradas.get(p.id);
        return e && e.produtos > 0 ? `${e.produtosOk}/${e.produtos}` : "";
      },
      sortable: true,
      render: (p) => {
        const e = entradas.get(p.id);
        return e && e.produtos > 0 ? (
          <Button variant="outline" aria-label={`Entrada do Pedido de ${dia(p.criadoEm)}: ${e.produtosOk} de ${e.produtos} produtos`} onClick={() => void verEntrada(p)}>
            <PackageCheck />
            {e.produtosOk}/{e.produtos}
          </Button>
        ) : null;
      },
    },
  ];
  return (
    <Stack gap="section">
      <DataTable
        title="Pedidos"
        columns={colunas}
        rows={pedidos}
        getRowId={(p) => p.id}
        loading={carregando}
        emptyMessage="Nenhum Pedido ainda. Marque produtos no Lançamento e use Gerar pedido."
        search={{ placeholder: "Buscar Pedido" }}
        rowActions={(p) =>
          p.status === "rascunho" ? (
            <Stack direction="row" gap="tight">
              <Button size="icon" variant="outline" aria-label={`Editar Pedido de ${dia(p.criadoEm)}`} onClick={() => void editar(p)}>
                <Pencil />
              </Button>
              <Button size="icon" variant="outline" aria-label={`Cotar Pedido de ${dia(p.criadoEm)}`} onClick={() => void cotar(p)}>
                <ClipboardList />
              </Button>
              <Button size="icon" variant="outline" aria-label={`Cancelar Pedido de ${dia(p.criadoEm)}`} onClick={() => void cancelar(p)}>
                <Ban />
              </Button>
            </Stack>
          ) : p.status === "cancelado" ? null : (
            <Stack direction="row" gap="tight">
              {EDITAVEIS.includes(p.status) && (
                <Button size="icon" variant="outline" aria-label={`Editar Pedido de ${dia(p.criadoEm)}`} onClick={() => void editar(p)}>
                  <Pencil />
                </Button>
              )}
            <Button size="icon" variant="outline" aria-label={`Cotação do Pedido de ${dia(p.criadoEm)}`} onClick={() => void verCotacao(p)}>
              <Scale />
            </Button>
              {EDITAVEIS.includes(p.status) && (
                <Button size="icon" variant="outline" aria-label={`Cancelar Pedido de ${dia(p.criadoEm)}`} onClick={() => void cancelar(p)}>
                  <Ban />
                </Button>
              )}
            </Stack>
          )
        }
      />
    </Stack>
  );
}
