import { useEffect, useRef, useState } from "react";
import { Pencil, Search, Undo2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Button } from "@platform/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@platform/ui/components/input-group";
import { Label } from "@platform/ui/components/label";
import { Stack } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { formatDate } from "@platform/ui/lib/format";
import { CorrecaoBaixaWindow, type CorrecaoDaBaixa } from "./correcao-baixa-window";
import type { BaixaPublica } from "./baixas-do-periodo";
import { dataHora } from "./datas";
import type { LojaOpcao } from "./loja-opcao";
import { LojaSelect, TODAS_AS_LOJAS } from "./loja-select";
import type { Visualizacao } from "./visualizacoes";

const BASE = "/api/m/inovafarma/pre-vencidos";

interface Periodo {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status?: "open" | "closed";
}

/** Uma Visualização das Baixas que o servidor liberou, com as Lojas que ela filtra (vazio em Individual). */
export interface VisualizacaoDasBaixas {
  id: Visualizacao;
  lojas: LojaOpcao[];
}

/** Uma Baixa: a venda do ERP, a Loja onde foi feita e quanto dela foi Pré-vencido. */
type Baixa = Omit<BaixaPublica, "correcao"> & { codigoLoja: number; correcao?: CorrecaoDaBaixa };

interface BaixasDoColaborador {
  codigoColaborador: number;
  nomeColaborador: string;
  quantidade: number;
  vendas: Baixa[];
}

/** Só as vendas do produto buscado (nome ou código de barras), com o total do Colaborador refeito; sem busca, tudo. */
function filtrarPorProduto(grupos: BaixasDoColaborador[], busca: string): BaixasDoColaborador[] {
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  if (!termo) return grupos;
  return grupos.flatMap((g) => {
    const vendas = g.vendas.filter((b) => b.nomeProduto.toLocaleLowerCase("pt-BR").includes(termo) || (b.codigoBarra ?? "").includes(termo));
    return vendas.length ? [{ ...g, vendas, quantidade: vendas.reduce((s, b) => s + b.quantidade, 0) }] : [];
  });
}

const VISUALIZACAO_LABEL: Record<Visualizacao, string> = { geral: "Geral", loja: "Loja", individual: "Individual" };
const periodoLabel = (p: Periodo) => `${p.name} (${formatDate(p.startDate)} a ${formatDate(p.endDate)})${p.status === "closed" ? " · fechado" : ""}`;

const colunasVenda: DataTableColumn<Baixa>[] = [
  { key: "venda", label: "Venda", value: (b) => String(b.vendaId) },
  { key: "data", centered: true, label: "Data", value: (b) => b.data, render: (b) => dataHora(b.data) },
  { key: "produto", label: "Produto", value: (b) => b.nomeProduto },
  { key: "vendida", label: "Qtde vendida", value: (b) => b.quantidadeVendida, format: "number" },
  { key: "quantidade", label: "Baixa", value: (b) => b.quantidade, format: "number" },
  { key: "correcao", label: "Correção", value: (b) => (b.correcao ? `${b.correcao.motivo}${b.correcao.autorNome ? ` (${b.correcao.autorNome})` : ""}` : "") },
];

interface Props {
  /** Visualizações que o servidor liberou, da mais ampla para a mais restrita. */
  visualizacoes: VisualizacaoDasBaixas[];
  periodos: Periodo[];
  /** Só para quem gere as Baixas: as Lojas do Vínculo, onde se corrige Baixa. */
  lojasDaCorrecao: number[];
}

/**
 * Aba Baixas: as Baixas de Pré-vencido de um Closing Period na Visualização escolhida (Geral, Loja ou Individual, como
 * no Desempenho de Vendas), por Colaborador e abertas por venda. Quem gere as Baixas corrige as vendas das Lojas do
 * Vínculo no Período aberto.
 */
export function BaixasPreVencidosTab({ visualizacoes, periodos, lojasDaCorrecao }: Props) {
  const { feedback, windows } = useUi();
  // Abre na Visualização mais ampla.
  const [visualizacao, setVisualizacao] = useState<Visualizacao | undefined>(visualizacoes[0]?.id);
  const [loja, setLoja] = useState(TODAS_AS_LOJAS);
  // Abre no período aberto de data mais recente; sem nenhum aberto, no mais recente.
  const [periodoId, setPeriodoId] = useState((periodos.find((p) => p.status !== "closed") ?? periodos[0])?.id ?? "");
  const [grupos, setGrupos] = useState<BaixasDoColaborador[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [produto, setProduto] = useState("");
  // Muda a cada Correção salva ou desfeita: recarrega as Baixas do servidor.
  const [recarga, setRecarga] = useState(0);

  // Só a resposta da última consulta vale.
  const consulta = useRef(0);
  useEffect(() => {
    if (!visualizacao || !periodoId) return;
    const minha = ++consulta.current;
    setCarregando(true);
    const params = new URLSearchParams({ visualizacao, periodoId });
    if (visualizacao !== "individual" && loja !== TODAS_AS_LOJAS) params.set("codigoLoja", loja);
    apiFetch<BaixasDoColaborador[]>(`${BASE}/baixas?${params.toString()}`)
      .then((recebidos) => {
        if (minha === consulta.current) setGrupos(recebidos);
      })
      .catch((err: unknown) => {
        if (minha === consulta.current) feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar as Baixas."));
      })
      .finally(() => {
        if (minha === consulta.current) setCarregando(false);
      });
  }, [visualizacao, loja, periodoId, feedback, recarga]);

  if (!visualizacao) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Sem Visualização</AlertTitle>
        <AlertDescription>Seu perfil não possui nenhuma visualização disponível das Baixas.</AlertDescription>
      </Alert>
    );
  }

  const lojas = visualizacoes.find((v) => v.id === visualizacao)?.lojas ?? [];
  // Só se corrige Baixa no Período aberto e nas Lojas do Vínculo.
  const aberto = periodos.find((p) => p.id === periodoId)?.status !== "closed";
  const podeCorrigir = (b: Baixa) => aberto && lojasDaCorrecao.includes(b.codigoLoja);

  const corrigir = async (venda: Baixa) => {
    const resultado = await windows.open<CorrecaoDaBaixa>({
      surface: "dialog",
      size: "small",
      title: venda.correcao ? "Alterar Correção de Baixa" : "Corrigir Baixa",
      description: `Venda ${venda.vendaId} · ${venda.nomeProduto}`,
      content: () => <CorrecaoBaixaWindow codigoLoja={venda.codigoLoja} periodoId={periodoId} venda={venda} />,
    });
    if (resultado.status === "confirmed") setRecarga((n) => n + 1);
  };

  const desfazer = async (venda: Baixa) => {
    if (!venda.correcao) return;
    const ok = await windows.confirm({
      title: "Desfazer Correção",
      description: `Desfazer a Correção da venda ${venda.vendaId}? A Baixa volta a ser calculada pelas vendas.`,
      confirmLabel: "Desfazer",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`${BASE}/baixas/correcoes/${venda.correcao.id}?version=${venda.correcao.version}`, { method: "DELETE" });
      feedback.notify({ type: "success", title: "Correção desfeita." });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao desfazer a Correção."));
    }
    setRecarga((n) => n + 1);
  };

  const acoesDaVenda = (b: Baixa) =>
    podeCorrigir(b) ? (
      <Stack direction="row" gap="tight">
        <Button size="icon" variant="ghost" aria-label={`Corrigir a Baixa da venda ${b.vendaId}`} onClick={() => void corrigir(b)}>
          <Pencil />
        </Button>
        {b.correcao && (
          <Button size="icon" variant="ghost" tone="destructive" aria-label={`Desfazer a Correção da venda ${b.vendaId}`} onClick={() => void desfazer(b)}>
            <Undo2 />
          </Button>
        )}
      </Stack>
    ) : null;

  const colunas: DataTableColumn<BaixasDoColaborador>[] = [
    { key: "colaborador", label: "Colaborador", value: (g) => g.nomeColaborador, searchable: true, sortable: true },
    { key: "vendas", label: "Vendas", value: (g) => g.vendas.length, format: "number", sortable: true },
    { key: "quantidade", label: "Pré-vencidos vendidos", value: (g) => g.quantidade, format: "number", sortable: true },
  ];

  return (
    <Stack gap="section">
      <Stack direction="row" align="end" gap="section" wrap>
        <Stack gap="field">
          <Label>Visualização</Label>
          <Select
            value={visualizacao}
            onValueChange={(v) => {
              if (!v) return;
              setVisualizacao(v as Visualizacao);
              setLoja(TODAS_AS_LOJAS);
            }}
          >
            <SelectTrigger aria-label="Visualização">
              <SelectValue>{(v: Visualizacao) => VISUALIZACAO_LABEL[v]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {visualizacoes.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {VISUALIZACAO_LABEL[v.id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Stack>
        {visualizacao !== "individual" && (
          <LojaSelect lojas={lojas} value={loja} onChange={setLoja} todas={visualizacao === "loja" ? "Todas as minhas Lojas" : "Todas as Filiais"} />
        )}
        <Stack gap="field">
          <Label>Período de Fechamento</Label>
          <Select value={periodoId} onValueChange={(v) => v && setPeriodoId(v)}>
            <SelectTrigger aria-label="Período de Fechamento">
              <SelectValue>{(id: string) => periodos.find((p) => p.id === id)?.name ?? "Selecione"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {periodos.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {periodoLabel(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Stack>
        <Stack gap="field">
          <Label htmlFor="baixas-produto">Produto</Label>
          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput id="baixas-produto" placeholder="Nome ou código de barras" value={produto} onChange={(e) => setProduto(e.target.value)} />
          </InputGroup>
        </Stack>
      </Stack>
      <DataTable
        scroll="page"
        columns={colunas}
        rows={filtrarPorProduto(grupos, produto)}
        getRowId={(g) => String(g.codigoColaborador)}
        loading={carregando}
        title="Baixas de Pré-vencido"
        description="As vendas no período que gastaram o Estoque de Pré-vencidos, por Colaborador."
        emptyMessage="Nenhuma Baixa no período."
        search={{ placeholder: "Buscar Colaborador" }}
        renderExpanded={(g) => (
          <DataTable
            scroll="page"
            columns={colunasVenda}
            rows={g.vendas}
            getRowId={(b) => `${b.codigoLoja}|${b.vendaId}|${b.produtoId}`}
            rowActions={aberto && lojasDaCorrecao.length > 0 ? acoesDaVenda : undefined}
          />
        )}
      />
    </Stack>
  );
}
