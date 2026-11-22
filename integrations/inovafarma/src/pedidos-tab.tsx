import { useCallback, useEffect, useState } from "react";
import { Ban, ClipboardList, Pencil, Scale } from "lucide-react";
import { Button } from "@platform/ui/components/button";
import { Stack } from "@platform/ui/components/layout";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { CotacaoFornecedoresWindow } from "./cotacao-fornecedores-window";
import { CotacaoWindow } from "./cotacao-window";
import { FalhaAoCarregar, useContexto } from "./contexto";
import { json } from "./inovafarma-api";
import type { LojaOpcao } from "./loja-opcao";
import { PEDIDOS_BASE, PedidoRascunhoWindow, type Pedido } from "./pedido-rascunho-window";
import { useLatestFetch } from "./use-latest-fetch";
import { API } from "./inovafarma-api";

const STATUS: Record<Pedido["status"], string> = { rascunho: "Rascunho", aguardando_precos: "Aguardando preços", cotado: "Cotado", confirmado: "Confirmado", parcialmente_recebido: "Parcialmente recebido", recebido: "Recebido", cancelado: "Cancelado" };
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/** Aba Pedidos: a listagem dos Pedidos, com edição e cancelamento do rascunho. */
export function PedidosTab() {
  const { windows, feedback } = useUi();
  const novaConsulta = useLatestFetch();
  const { contexto } = useContexto<{ lojas: LojaOpcao[] }>(`${API}/pedidos/lancamento/contexto`, "Erro ao carregar as Lojas.");
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const vale = novaConsulta();
    setCarregando(true);
    try {
      const r = await apiFetch<Pedido[]>(PEDIDOS_BASE);
      if (vale()) {
        setPedidos(r);
        setFalha(null);
      }
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
      size: "full",
      title: "Editar rascunho",
      description: `Pedido de ${dia(pedido.criadoEm)}`,
      content: () => <PedidoRascunhoWindow itens={pedido.itens} lojas={contexto?.lojas ?? []} pedido={pedido} />,
    });
    void carregar();
  };

  const cotar = async (pedido: Pedido) => {
    const iniciada = await windows.open<true>({
      surface: "dialog",
      size: "medium",
      title: "Cotar Pedido",
      description: `Escolha os fornecedores do Pedido de ${dia(pedido.criadoEm)}`,
      content: () => <CotacaoFornecedoresWindow pedido={pedido} />,
    });
    void carregar();
    if (iniciada.status === "confirmed") await verCotacao(pedido);
  };

  const verCotacao = async (pedido: Pedido) => {
    await windows.open({
      surface: "dialog",
      size: "full",
      title: "Cotação",
      description: `Pedido de ${dia(pedido.criadoEm)}`,
      content: () => <CotacaoWindow pedidoId={pedido.id} lojas={contexto?.lojas ?? []} />,
    });
    void carregar();
  };

  const cancelar = async (pedido: Pedido) => {
    const ok = await windows.confirm({
      title: "Cancelar Pedido",
      description: `Cancelar o rascunho do Pedido de ${dia(pedido.criadoEm)}? Um Pedido cancelado não pode mais ser editado.`,
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
    { key: "criadoEm", label: "Criado em", format: "date", value: (p) => p.criadoEm, sortable: true, firstSort: "desc" },
    { key: "criadoPor", label: "Criado por", value: (p) => p.criadoPorNome, searchable: true, mobileRole: "primary" },
    { key: "produtos", label: "Produtos", format: "decimal", value: (p) => p.itens.length },
    { key: "status", label: "Situação", value: (p) => STATUS[p.status], searchable: true },
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
              <Button size="icon" variant="ghost" aria-label={`Cotar Pedido de ${dia(p.criadoEm)}`} onClick={() => void cotar(p)}>
                <ClipboardList />
              </Button>
              <Button size="icon" variant="ghost" aria-label={`Editar Pedido de ${dia(p.criadoEm)}`} onClick={() => void editar(p)}>
                <Pencil />
              </Button>
              <Button size="icon" variant="ghost" aria-label={`Cancelar Pedido de ${dia(p.criadoEm)}`} onClick={() => void cancelar(p)}>
                <Ban />
              </Button>
            </Stack>
          ) : p.status === "cancelado" ? null : (
            <Button size="icon" variant="ghost" aria-label={`Cotação do Pedido de ${dia(p.criadoEm)}`} onClick={() => void verCotacao(p)}>
              <Scale />
            </Button>
          )
        }
      />
    </Stack>
  );
}
