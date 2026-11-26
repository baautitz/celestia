import { Badge } from "@platform/ui/components/badge";
import { useCallback, useEffect, useState } from "react";
import { Ban, Check, CheckCheck, ClipboardList, FileDown, PackageCheck, Pencil, Scale, SlidersHorizontal } from "lucide-react";
import { Button } from "@platform/ui/components/button";
import { Stack, Text } from "@platform/ui/components/layout";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { abrirPdfsDasLojas } from "./pdfs-das-lojas";
import { baixar, CotacaoWindow } from "./cotacao-window";
import { FalhaAoCarregar, useContexto } from "./contexto";
import { json } from "./inovafarma-api";
import type { LojaOpcao } from "./loja-opcao";
import { PEDIDOS_BASE, type Pedido } from "./pedido-rascunho-window";
import { EntradaWindow } from "./pedido-entrada-window";
import { filtrarPedidos, PedidosFiltrosSheet, resumoDosFiltros, SEM_FILTROS, type FiltrosPedidos, type OpcaoFornecedor } from "./pedidos-filtros";
import { PedidoLancamentoWindow } from "./pedidos-lancamento-tab";
import { useLatestFetch } from "./use-latest-fetch";
import { API } from "./inovafarma-api";

/** Situações em que o Pedido ainda pode ser editado. */
const EDITAVEIS: Pedido["status"][] = ["aguardando_precos", "cotado"];
const STATUS: Record<Pedido["status"], string> = { rascunho: "Rascunho", aguardando_precos: "Aguardando preços", cotado: "Cotado", confirmado: "Confirmado", parcialmente_recebido: "Parcialmente recebido", recebido: "Recebido", finalizado: "Finalizado", cancelado: "Cancelado" };
const COR_DA_SITUACAO = { rascunho: "secondary", aguardando_precos: "warning", cotado: "info", confirmado: "default", parcialmente_recebido: "warning", recebido: "success", finalizado: "outline", cancelado: "destructive" } as const satisfies Record<Pedido["status"], string>;
/** Confirmado e ainda em aberto: dá para finalizar à mão ou cancelar. */
const ABERTOS: Pedido["status"][] = ["confirmado", "parcialmente_recebido"];
interface Recebimento { pedidoId: string; pedida: number; recebida: number; produtos: number; produtosOk: number }
const lojasFornecedoras = (p: Pedido) => [...new Set(p.itens.flatMap((i) => i.quantidades.flatMap((q) => (q.lojasFornecedoras ?? []).map((l) => l.codigoLoja))))];
/** Tudo vem de outras Lojas: não há cotação. */
const soDeLojas = (p: Pedido) => p.itens.every((i) => i.quantidades.every((q) => q.quantidade === (q.lojasFornecedoras ?? []).reduce((t, l) => t + l.quantidade, 0)));
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

  // `produtos`: os produtoIds que passam no filtro de produtos (grupo, seção e laboratório só o ERP resolve).
  const [filtro, setFiltro] = useState<{ filtros: FiltrosPedidos; produtos: ReadonlySet<string> | null }>({ filtros: SEM_FILTROS, produtos: null });
  const [distribuidoras, setDistribuidoras] = useState<OpcaoFornecedor[]>([]);
  useEffect(() => {
    apiFetch<OpcaoFornecedor[]>(`${API}/pedidos/fornecedores?busca=`)
      .then((r) => setDistribuidoras(Array.isArray(r) ? r : []))
      .catch(() => undefined);
  }, []);
  const fornecedores = [...distribuidoras, ...(contexto?.lojas ?? []).map((l) => ({ codigo: -l.codigo, nome: l.nome }))];

  const abrirFiltros = async () => {
    const r = await windows.open<FiltrosPedidos>({
      surface: "sheet",
      title: "Filtros",
      content: () => <PedidosFiltrosSheet inicial={filtro.filtros} situacoes={STATUS} lojas={contexto?.lojas ?? []} fornecedores={fornecedores} />,
    });
    if (r.status !== "confirmed") return;
    const filtros = r.value;
    try {
      const produtos = filtros.entradas.length
        ? new Set((await apiFetch<{ produtoIds: string[] }>(`${PEDIDOS_BASE}/filtrar-produtos`, json("POST", { entradas: filtros.entradas }))).produtoIds)
        : null;
      setFiltro({ filtros, produtos });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao filtrar os produtos."));
    }
  };
  const resumo = resumoDosFiltros(filtro.filtros, STATUS, fornecedores);

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

  const confirmarSoDeLojas = async (pedido: Pedido) => {
    const ok = await windows.confirm({
      title: "Confirmar Pedido",
      description: `Confirmar o Pedido de ${dia(pedido.criadoEm)}? Ele é só de Lojas e não passa por cotação.`,
      confirmLabel: "Confirmar Pedido",
    });
    if (!ok) return;
    try {
      await apiFetch(`${PEDIDOS_BASE}/${pedido.id}/confirmar`, json("POST", { escolhas: {}, version: pedido.version }));
      feedback.notify({ type: "success", title: "Pedido confirmado." });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao confirmar o Pedido."));
    }
    void carregar();
  };

  const pdfDasLojas = async (pedido: Pedido) => {
    const lojas = lojasFornecedoras(pedido).map((codigo) => ({ codigo, nome: contexto?.lojas.find((l) => l.codigo === codigo)?.nome ?? `Loja ${codigo}` }));
    await abrirPdfsDasLojas({ windows, feedback }, pedido.id, lojas, baixar);
  };

  /** As Lojas em que o Usuário mexe; `null` = todas. O servidor é quem recusa: aqui só se escondem as ações. */
  const [minhasLojas, setMinhasLojas] = useState<number[] | null>(null);
  useEffect(() => {
    apiFetch<{ lojas?: number[] | null }>(`${API}/pedidos/meu-escopo`)
      .then((r) => setMinhasLojas(Array.isArray(r?.lojas) ? r.lojas : null))
      .catch(() => undefined);
  }, []);
  const noEscopo = (p: Pedido) => minhasLojas === null || p.itens.every((i) => i.quantidades.every((q) => q.quantidade <= 0 || minhasLojas.includes(q.codigoLoja)));

  const finalizar = async (pedido: Pedido) => {
    const ok = await windows.confirm({
      title: "Finalizar Pedido",
      description: `Finalizar o Pedido de ${dia(pedido.criadoEm)}? O que ainda não chegou deixa de ser esperado. Não dá para reabrir.`,
      confirmLabel: "Finalizar Pedido",
    });
    if (!ok) return;
    try {
      await apiFetch(`${PEDIDOS_BASE}/${pedido.id}/finalizar`, json("POST", { version: pedido.version }));
      feedback.notify({ type: "success", title: "Pedido finalizado." });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao finalizar o Pedido."));
    }
    void carregar();
  };

  const cancelar = async (pedido: Pedido) => {
    const ok = await windows.confirm({
      title: "Cancelar Pedido",
      description: ABERTOS.includes(pedido.status) || pedido.status === "finalizado"
        ? `Cancelar o Pedido de ${dia(pedido.criadoEm)}? Ele já foi confirmado: deixa de ser esperado. O que já deu entrada continua no ERP.`
        : `Cancelar o Pedido de ${dia(pedido.criadoEm)}? Um Pedido cancelado não pode mais ser editado nem cotado.`,
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
    { key: "status", label: "Situação", value: (p) => STATUS[p.status], searchable: true, render: (p) => <Badge variant={COR_DA_SITUACAO[p.status]}>{STATUS[p.status]}</Badge> },
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
        headerActions={
          <Stack direction="row" gap="field" align="center">
            {resumo ? (
              <Text variant="caption" tone="muted">
                {resumo}
              </Text>
            ) : null}
            <Button type="button" variant="outline" onClick={() => void abrirFiltros()}>
              <SlidersHorizontal />
              Filtros
            </Button>
          </Stack>
        }
        columns={colunas}
        rows={filtrarPedidos(pedidos, filtro.filtros, filtro.produtos)}
        getRowId={(p) => p.id}
        loading={carregando}
        emptyMessage={resumo ? "Nenhum Pedido com esses filtros." : "Nenhum Pedido ainda. Marque produtos no Lançamento e use Gerar pedido."}
        search={{ placeholder: "Buscar Pedido" }}
        rowActions={(p) =>
          !noEscopo(p) ? (
            p.status === "rascunho" || p.status === "cancelado" || soDeLojas(p) ? null : (
              <Stack direction="row" gap="tight">
                <Button size="icon" variant="outline" aria-label={`Cotação do Pedido de ${dia(p.criadoEm)}`} onClick={() => void verCotacao(p)}>
                  <Scale />
                </Button>
              </Stack>
            )
          ) : p.status === "rascunho" ? (
            <Stack direction="row" gap="tight">
              <Button size="icon" variant="outline" aria-label={`Editar Pedido de ${dia(p.criadoEm)}`} onClick={() => void editar(p)}>
                <Pencil />
              </Button>
              {soDeLojas(p) ? (
                <Button size="icon" variant="outline" aria-label={`Confirmar Pedido de ${dia(p.criadoEm)}`} onClick={() => void confirmarSoDeLojas(p)}>
                  <Check />
                </Button>
              ) : (
                <Button size="icon" variant="outline" aria-label={`Cotar Pedido de ${dia(p.criadoEm)}`} onClick={() => void cotar(p)}>
                  <ClipboardList />
                </Button>
              )}
              {lojasFornecedoras(p).length > 0 && (
                <Button size="icon" variant="outline" aria-label={`PDF das Lojas do Pedido de ${dia(p.criadoEm)}`} onClick={() => void pdfDasLojas(p)}>
                  <FileDown />
                </Button>
              )}
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
              {!soDeLojas(p) && (
                <Button size="icon" variant="outline" aria-label={`Cotação do Pedido de ${dia(p.criadoEm)}`} onClick={() => void verCotacao(p)}>
                  <Scale />
                </Button>
              )}
              {soDeLojas(p) && EDITAVEIS.includes(p.status) && (
                <Button size="icon" variant="outline" aria-label={`Confirmar Pedido de ${dia(p.criadoEm)}`} onClick={() => void confirmarSoDeLojas(p)}>
                  <Check />
                </Button>
              )}
              {lojasFornecedoras(p).length > 0 && (
                <Button size="icon" variant="outline" aria-label={`PDF das Lojas do Pedido de ${dia(p.criadoEm)}`} onClick={() => void pdfDasLojas(p)}>
                  <FileDown />
                </Button>
              )}
              {ABERTOS.includes(p.status) && (
                <Button size="icon" variant="outline" aria-label={`Finalizar Pedido de ${dia(p.criadoEm)}`} onClick={() => void finalizar(p)}>
                  <CheckCheck />
                </Button>
              )}
              {(EDITAVEIS.includes(p.status) || ABERTOS.includes(p.status) || p.status === "finalizado") && (
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
