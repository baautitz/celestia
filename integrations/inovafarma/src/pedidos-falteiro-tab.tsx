import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { Show, Stack } from "@platform/ui/components/layout";
import { HeaderActions } from "@platform/ui/context/header-actions";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { formatDate } from "@platform/ui/lib/format";
import { FalhaAoCarregar } from "./contexto";
import type { LojaOpcao } from "./loja-opcao";
import type { FaltaComErp } from "./pedidos-falteiro-routes";
import { FALTEIRO_BASE, FalteiroWindow } from "./pedidos-falteiro-window";
import { useLatestFetch } from "./use-latest-fetch";

export interface DadosFalteiroTab {
  todasAsLojas: boolean;
  lojas: LojaOpcao[];
  lojasPermitidas: number[] | null;
  itens: FaltaComErp[];
}

/** Aba Falteiro: listagem de produtos em falta com estoque atual no ERP e sugestão manual de remoção. */
export function PedidosFalteiroTab() {
  const { windows, feedback } = useUi();
  const novaConsulta = useLatestFetch();
  const [dados, setDados] = useState<DadosFalteiroTab | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const vale = novaConsulta();
    setCarregando(true);
    try {
      const recebido = await apiFetch<DadosFalteiroTab>(FALTEIRO_BASE);
      if (!vale()) return;
      setDados(recebido);
      setFalha(null);
    } catch (err: unknown) {
      if (vale()) setFalha(err instanceof Error ? err.message : "Erro ao carregar o Falteiro.");
    } finally {
      if (vale()) setCarregando(false);
    }
  }, [novaConsulta]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!dados && falha) {
    return <FalhaAoCarregar titulo="Não foi possível carregar o Falteiro" descricao={falha} onTentarNovamente={() => void carregar()} />;
  }

  const lojasDisponiveis = dados
    ? dados.lojasPermitidas === null
      ? dados.lojas
      : dados.lojas.filter((l) => dados.lojasPermitidas?.includes(l.codigo))
    : [];

  const podeAtuar = (f: FaltaComErp) => {
    if (!dados) return false;
    if (dados.todasAsLojas || dados.lojasPermitidas === null) return true;
    return f.codigoLoja !== null && dados.lojasPermitidas.includes(f.codigoLoja);
  };

  const nomeLoja = (codigo: number) => dados?.lojas.find((l) => l.codigo === codigo)?.nome || `Loja ${codigo}`;

  const abrir = async (falta?: FaltaComErp) => {
    if (!dados) return;
    await windows.open({
      surface: "dialog",
      size: "small",
      title: falta ? "Editar falta" : "Registrar falta",
      description: falta ? falta.nomeProduto : "Registre um produto em falta para destacá-lo no Lançamento.",
      content: () => <FalteiroWindow lojas={lojasDisponiveis} todasAsLojas={dados.todasAsLojas} falta={falta} />,
    });
    void carregar();
  };

  const remover = async (falta: FaltaComErp) => {
    const destino = falta.codigoLoja === null ? "Todas as Lojas" : `Loja ${nomeLoja(falta.codigoLoja)}`;
    const ok = await windows.confirm({
      title: "Remover falta",
      description: `Remover "${falta.nomeProduto}" (${destino}) do Falteiro?`,
      confirmLabel: "Remover",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`${FALTEIRO_BASE}/${falta.id}?version=${falta.version}`, { method: "DELETE" });
      feedback.notify({ type: "success", title: "Falta removida do Falteiro." });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao remover a falta."));
    }
    void carregar();
  };

  const semVinculo = dados && !dados.todasAsLojas && lojasDisponiveis.length === 0;

  const colunas: DataTableColumn<FaltaComErp>[] = [
    { key: "produto", label: "Produto", value: (f) => f.nomeProduto, searchable: true, sortable: true, mobileRole: "primary" },
    { key: "codigoBarra", label: "Cód. barras", value: (f) => f.codigoBarra ?? "", searchable: true },
    {
      key: "loja",
      label: "Loja",
      value: (f) => (f.codigoLoja === null ? "Todas as Lojas" : nomeLoja(f.codigoLoja)),
      searchable: true,
      sortable: true,
    },
    { key: "quantidade", label: "Qtde. desejada", format: "number", value: (f) => f.quantidade, sortable: true },
    { key: "estoque", label: "Estoque atual", format: "decimal", value: (f) => f.estoque, sortable: true },
    {
      key: "situacao",
      centered: true,
      label: "Situação",
      value: (f) => (f.sugerirRemocao ? 1 : 0),
      sortable: true,
      firstSort: "desc",
      render: (f) =>
        f.sugerirRemocao ? (
          <Badge variant="success">Reposto · Sugerir remoção</Badge>
        ) : (
          <Badge variant="warning">Em falta</Badge>
        ),
    },
    { key: "observacao", label: "Observação", value: (f) => f.observacao ?? "", searchable: true },
    { key: "criadoPor", label: "Registrado por", value: (f) => f.criadoPorNome, searchable: true },
    { key: "criadoEm", centered: true, label: "Registrado em", value: (f) => f.criadoEm, render: (f) => formatDate(f.criadoEm), sortable: true },
  ];

  return (
    <Stack gap="section">
      {!semVinculo && (
        <HeaderActions>
          <Show on="lgUp">
            <Button type="button" disabled={!dados} onClick={() => void abrir()}>
              <Plus />
              Registrar falta
            </Button>
          </Show>
          <Show on="belowLg">
            <Button type="button" variant="outline" size="icon" aria-label="Registrar falta" title="Registrar falta" disabled={!dados} onClick={() => void abrir()}>
              <Plus />
            </Button>
          </Show>
        </HeaderActions>
      )}
      {semVinculo && (
        <Alert variant="destructive">
          <AlertTitle>Sem Loja vinculada</AlertTitle>
          <AlertDescription>Seu usuário não está vinculado a uma Loja. Peça o vínculo a quem administra os Colaboradores para registrar faltas.</AlertDescription>
        </Alert>
      )}
      <DataTable
        scroll="page"
        title="Falteiro"
        description="Produtos marcados em falta ganham destaque no Lançamento. Quando entra NF e o estoque fica positivo, a linha sugere a remoção manual."
        columns={colunas}
        rows={dados?.itens ?? []}
        getRowId={(f) => f.id}
        loading={carregando}
        highlightRow={(f) => f.sugerirRemocao}
        search={{ placeholder: "Buscar produto, Loja ou observação" }}
        emptyMessage="Nenhum produto no Falteiro."
        rowActions={(f) =>
          podeAtuar(f) ? (
            <Stack direction="row" gap="tight">
              <Button type="button" size="icon" variant="outline" aria-label={`Editar falta de ${f.nomeProduto}`} onClick={() => void abrir(f)}>
                <Pencil />
              </Button>
              <Button type="button" size="icon" variant="outline" tone="destructive" aria-label={`Remover falta de ${f.nomeProduto}`} onClick={() => void remover(f)}>
                <Trash2 />
              </Button>
            </Stack>
          ) : null
        }
      />
    </Stack>
  );
}
