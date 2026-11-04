import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Badge } from "@platform/ui/components/badge";
import { Label } from "@platform/ui/components/label";
import { PairGrid, Stack, Text } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { dataHora } from "./datas";
import { reais } from "./indicadores";
import type { MinhaBaixa, MinhaMeta } from "./minhas-metas";
import type { PeriodoMetas } from "./montar-metas-tab";
import { OlhoAvaliacoes } from "./avaliacoes-do-colaborador";
import { useVisaoMetas, VisaoSelect } from "./metas-visualizacao";

interface MinhasMetas {
  congelada: boolean;
  periodoAnterior?: { id: string; name: string } | null;
  metas: MinhaMeta[];
  /** Baixas de Pré-vencido do Colaborador no Período: só quem tem Meta de Pré-vencidos. */
  baixas: MinhaBaixa[];
}

/** O resultado na Exibição do Tipo de Meta; o servidor já cortou o que o Colaborador não vê. */
function resultado(m: MinhaMeta): string {
  if (m.realizado === undefined) return "";
  const alvo = m.alvo ? ` de ${m.alvo}` : "";
  return `Realizado ${m.realizado}${alvo}${m.falta ? ` · faltam ${m.falta}` : ""}`;
}

const colunas: DataTableColumn<MinhaMeta>[] = [
  {
    key: "meta",
    label: "Meta",
    value: (m) => m.nome,
    searchable: true,
    sortable: true,
    mobileRole: "primary",
    // Na Lista de Produtos, o Colaborador vê o que conta.
    render: (m) =>
      m.lista ? (
        <Stack gap="tight">
          <Text weight="medium">{m.nome}</Text>
          <Text variant="caption" tone="muted">
            {m.lista.join(" · ")}
          </Text>
        </Stack>
      ) : (
        m.nome
      ),
  },
  { key: "resultado", label: "Resultado", value: resultado },
  {
    key: "situacao",
    centered: true,
    label: "Situação",
    value: (m) => (m.atingida === null ? "" : m.atingida ? "Atingida" : "Não atingida"),
    render: (m) => (m.atingida === null ? null : <Badge variant={m.atingida ? "default" : "outline"}>{m.atingida ? "Atingida" : "Não atingida"}</Badge>),
  },
  { key: "premio", label: "Prêmio", value: (m) => (m.premioCentavos === undefined ? null : m.premioCentavos / 100), format: "currency" },
];

/** Visualização Tabela: cada Meta com rótulo e valor; em cima o Período anterior, embaixo o atual. */
const colunasTabela = (olho: (m: MinhaMeta) => React.ReactNode): DataTableColumn<MinhaMeta>[] => [
  colunas[0]!,
  {
    key: "valores",
    label: "Metas",
    divider: true,
    value: (m) => m.realizado ?? "",
    render: (m) => (
      <PairGrid
        pairs={3}
        rows={[
          [
            { label: "Meta anterior", value: m.anterior?.alvo ?? "–" },
            {
              label: "Atingido",
              value: m.anterior?.realizado ? <Text variant="small" tone={m.anterior.atingida === true ? "success" : "default"}>{m.anterior.realizado}</Text> : "–",
            },
            { label: "", value: null },
          ],
          [
            { label: "Meta atual", value: m.alvo ?? "–" },
            {
              label: "Realizado",
              value: (
                <Stack direction="row" gap="tight" align="center">
                  {m.realizado ?? "–"}
                  {olho(m)}
                </Stack>
              ),
            },
            { label: "Prêmio", value: m.premioCentavos === undefined ? "–" : reais(m.premioCentavos) },
          ],
        ]}
      />
    ),
    cellClassName: "min-w-md",
  },
  { ...colunas[2]!, divider: true },
];

const colunasBaixa: DataTableColumn<MinhaBaixa>[] = [
  { key: "venda", label: "Venda", value: (b) => String(b.vendaId), mobileRole: "primary" },
  { key: "data", centered: true, label: "Data", value: (b) => b.data, render: (b) => dataHora(b.data) },
  { key: "produto", label: "Produto", value: (b) => b.nomeProduto },
  { key: "vendida", label: "Qtde vendida", value: (b) => b.quantidadeVendida, format: "number" },
  { key: "quantidade", label: "Pré-vencido", value: (b) => b.quantidade, format: "number" },
  { key: "correcao", label: "Correção", value: (b) => (b.correcao ? `Corrigida: ${b.correcao.motivo}` : "") },
];

const periodoInicial = (periodos: PeriodoMetas[]) => (periodos.find((p) => p.status === "open") ?? periodos[0])?.id ?? "";

/** Aba Minhas Metas: as Metas do Colaborador vinculado ao Usuário, na Exibição de cada Tipo de Meta. Sem impressão. */
export function MinhasMetas({ periodos, lerAvaliacoes = false }: { periodos: PeriodoMetas[]; lerAvaliacoes?: boolean }) {
  const { feedback } = useUi();
  const { visao, salvar: salvarVisao, disponiveis } = useVisaoMetas("minhas-metas", ["table", "list"], "list");
  const [periodoId, setPeriodoId] = useState(() => periodoInicial(periodos));
  const [dados, setDados] = useState<MinhasMetas | null>(null);
  const [carregando, setCarregando] = useState(false);
  const consulta = useRef(0);

  const carregar = useCallback(async () => {
    if (!periodoId) return;
    const minha = ++consulta.current;
    setCarregando(true);
    try {
      const d = await apiFetch<MinhasMetas>(`/api/m/inovafarma/metas/minhas?periodoId=${encodeURIComponent(periodoId)}`);
      if (minha === consulta.current) setDados(d);
    } catch (err: unknown) {
      if (minha === consulta.current) {
        setDados(null);
        feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar as suas Metas."));
      }
    } finally {
      if (minha === consulta.current) setCarregando(false);
    }
  }, [periodoId, feedback]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (periodos.length === 0)
    return (
      <Alert>
        <AlertTitle>Nenhum Período de Fechamento</AlertTitle>
        <AlertDescription>Ainda não há Período de Fechamento com Metas.</AlertDescription>
      </Alert>
    );

  // Na Meta de Avaliações, o olho abre as Avaliações recebidas (só com a Permission de vê-las).
  const olho = (m: MinhaMeta) =>
    lerAvaliacoes && m.indicador === "avaliacoes" ? <OlhoAvaliacoes periodoId={periodoId} codigoColaborador={0} nome="você" acesso="minhas" /> : null;
  const colunasLista: DataTableColumn<MinhaMeta>[] = colunas.map((c) =>
    c.key === "resultado" ? { ...c, render: (m: MinhaMeta) => (
      <Stack direction="row" gap="tight" align="center">
        {resultado(m)}
        {olho(m)}
      </Stack>
    ) } : c,
  );
  return (
    <Stack gap="section">
      <Stack direction="row" align="end" gap="section" wrap>
      <VisaoSelect visao={visao} disponiveis={disponiveis} onChange={salvarVisao} />
      <Stack gap="field">
        <Label>Período de Fechamento</Label>
        <Select value={periodoId} onValueChange={(v) => v && setPeriodoId(v)}>
          <SelectTrigger aria-label="Período de Fechamento">
            <SelectValue>{(id: string) => periodos.find((p) => p.id === id)?.name ?? "Selecione"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {periodos.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.status === "closed" ? " · fechado" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Stack>
      </Stack>
      <DataTable
        scroll="page"
        columns={visao === "table" ? colunasTabela(olho) : colunasLista}
        rows={dados?.metas ?? []}
        getRowId={(m) => m.metaId}
        loading={carregando}
        title="Minhas Metas"
        description={`${dados?.congelada ? "Período fechado: resultado gravado no fechamento." : "O resultado acompanha as vendas do ERP até o fechamento do Período."}${visao === "table" && dados?.periodoAnterior ? ` Período anterior: ${dados.periodoAnterior.name}.` : ""}`}
        emptyMessage="Você não participa de nenhuma Meta neste Período."
        striped
      />
      {dados && dados.baixas.length > 0 && (
        <DataTable
          scroll="page"
          columns={colunasBaixa}
          rows={dados.baixas}
          getRowId={(b) => `${b.vendaId}|${b.produtoId}`}
          title="Minhas Baixas de Pré-vencido"
          description="As suas vendas no Período que gastaram o Estoque de Pré-vencidos: é o que conta em Pré-vencidos vendidos."
        />
      )}
    </Stack>
  );
}
