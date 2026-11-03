import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2, MoreHorizontal } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@platform/ui/components/dropdown-menu";
import { Label } from "@platform/ui/components/label";
import { Show, Stack } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Tabs, TabsList, TabsTrigger } from "@platform/ui/components/tabs";
import { useTabParam } from "@platform/ui/hooks/use-tab-param";
import { HeaderActions } from "@platform/ui/context/header-actions";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { formatDate } from "@platform/ui/lib/format";
import { BaixasPreVencidosTab } from "./baixas-pre-vencidos-tab";
import { EstoquePreVencidosTab } from "./estoque-pre-vencidos-tab";
import { LancamentoWindow, type Lancamento, type LojaOpcao } from "./pre-vencido-window";

const BASE = "/api/m/inovafarma/pre-vencidos";
const TODAS = "todas";

interface Periodo {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status?: "open" | "closed";
}

interface Contexto {
  podeLancar: boolean;
  podeConferir: boolean;
  podeEstoque: boolean;
  podeBaixas: boolean;
  vinculado: boolean;
  /** Closing Periods, o de data mais recente primeiro; só os abertos aceitam lançar, editar e excluir. */
  periodos: Periodo[];
  lojas: LojaOpcao[];
  periodosConferencia?: Periodo[];
  lojasConferencia?: LojaOpcao[];
  /** Lojas do Vínculo, para o Estoque. */
  lojasEstoque?: LojaOpcao[];
  /** Lojas do Vínculo, para as Baixas. */
  lojasBaixas?: LojaOpcao[];
}

interface DetalheConferencia {
  produtoId: string;
  nomeProduto: string;
  validades: string[];
  quantidadeLancada: number;
  quantidadeVendida: number;
  situacao: "verde" | "vermelho";
}

interface LinhaConferencia {
  codigoColaborador: number;
  nomeColaborador: string;
  produtos: number;
  quantidadeLancada: number;
  quantidadeVendida: number;
  produtosConformes: number;
  situacao: "verde" | "vermelho";
  detalhe: DetalheConferencia[];
}

const validadeLabel = (validade: string) => validade.split("-").reverse().join("/");
const periodoLabel = (p: Periodo) => `${p.name} (${formatDate(p.startDate)} a ${formatDate(p.endDate)})${p.status === "closed" ? " · fechado" : ""}`;

function SeletorPeriodo({ periodos, valor, onChange }: { periodos: Periodo[]; valor: string; onChange: (id: string) => void }) {
  return (
    <Stack gap="field">
      <Label>Período de Fechamento</Label>
      <Select value={valor} onValueChange={(v) => v && onChange(v)}>
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
  );
}

function MeusLancamentos({ contexto }: { contexto: Contexto }) {
  const { feedback, windows } = useUi();
  // Abre no período aberto de data mais recente; sem nenhum aberto, no mais recente.
  const [periodoId, setPeriodoId] = useState((contexto.periodos.find((p) => p.status !== "closed") ?? contexto.periodos[0])?.id ?? "");
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [carregando, setCarregando] = useState(false);

  // Só a resposta da última consulta vale: uma resposta atrasada não apaga o que uma consulta mais nova trouxe.
  const consulta = useRef(0);
  const carregar = useCallback(async () => {
    if (!periodoId) return;
    const minha = ++consulta.current;
    setCarregando(true);
    try {
      const recebidos = await apiFetch<Lancamento[]>(`${BASE}/lancamentos?periodoId=${encodeURIComponent(periodoId)}`);
      if (minha === consulta.current) setLancamentos(recebidos);
    } catch (err: unknown) {
      if (minha === consulta.current) feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar os lançamentos."));
    } finally {
      if (minha === consulta.current) setCarregando(false);
    }
  }, [periodoId, feedback]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!contexto.vinculado) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Sem vínculo</AlertTitle>
        <AlertDescription>Seu Usuário não está vinculado a um Colaborador. Peça o vínculo a quem administra os Colaboradores.</AlertDescription>
      </Alert>
    );
  }
  if (contexto.periodos.length === 0) {
    return (
      <Alert>
        <AlertTitle>Nenhum Período de Fechamento</AlertTitle>
        <AlertDescription>Os lançamentos só podem ser feitos em um Período de Fechamento aberto.</AlertDescription>
      </Alert>
    );
  }
  const aberto = contexto.periodos.find((p) => p.id === periodoId)?.status !== "closed";

  const abrir = async (lancamento?: Lancamento) => {
    const resultado = await windows.open<Lancamento>({
      surface: "dialog",
      size: "small",
      title: lancamento ? "Editar lançamento" : "Novo lançamento",
      description: lancamento ? lancamento.nomeProduto : "Lance um Pré-vencido que você vendeu.",
      content: () => <LancamentoWindow periodoId={periodoId} lojas={contexto.lojas} lancamento={lancamento} />,
    });
    if (resultado.status !== "confirmed") return;
    // O lançamento salvo já aparece na tabela; a recarga confirma com o servidor.
    const salvo = resultado.value;
    if (salvo.periodoId === periodoId) {
      setLancamentos((atuais) => (atuais.some((l) => l.id === salvo.id) ? atuais.map((l) => (l.id === salvo.id ? salvo : l)) : [salvo, ...atuais]));
    }
    void carregar();
  };

  const excluir = async (lancamento: Lancamento) => {
    const ok = await windows.confirm({
      title: "Excluir lançamento",
      description: `Excluir o lançamento de ${lancamento.quantidade} un. de "${lancamento.nomeProduto}"?`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`${BASE}/lancamentos/${lancamento.id}?version=${lancamento.version}`, { method: "DELETE" });
      feedback.notify({ type: "success", title: "Lançamento excluído." });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao excluir o lançamento."));
    }
    void carregar();
  };

  const nomeLoja = (codigo: number) => contexto.lojas.find((l) => l.codigo === codigo)?.nome || `Loja ${codigo}`;
  const colunas: DataTableColumn<Lancamento>[] = [
    { key: "produto", label: "Produto", value: (l) => l.nomeProduto, searchable: true, sortable: true },
    { key: "codigoBarra", label: "Código de barras", value: (l) => l.codigoBarra ?? "", searchable: true },
    { key: "loja", label: "Loja", value: (l) => nomeLoja(l.codigoLoja), sortable: true },
    { key: "quantidade", label: "Quantidade", value: (l) => l.quantidade, format: "number", sortable: true },
    { key: "validade", centered: true, label: "Validade", value: (l) => l.validade, render: (l) => validadeLabel(l.validade), sortable: true },
  ];

  return (
    <Stack gap="section">
      <HeaderActions>
        <Show on="lgUp">
          <Button disabled={!aberto} onClick={() => void abrir()}>
            <Plus />
            Novo lançamento
          </Button>
        </Show>
        <Show on="belowLg">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Mais ações" />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!aberto} onClick={() => void abrir()}>
                <Plus />
                Novo lançamento
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Show>
      </HeaderActions>
      <SeletorPeriodo periodos={contexto.periodos} valor={periodoId} onChange={setPeriodoId} />
      {!aberto && (
        <Alert>
          <AlertTitle>Período fechado</AlertTitle>
          <AlertDescription>Neste período você só consulta os lançamentos. Para lançar, escolha um Período de Fechamento aberto.</AlertDescription>
        </Alert>
      )}
      <DataTable
        scroll="page"
        columns={colunas}
        rows={lancamentos}
        getRowId={(l) => l.id}
        loading={carregando}
        title="Meus lançamentos"
        emptyMessage="Nenhum lançamento neste período."
        search={{ placeholder: "Buscar produto" }}
        rowActions={aberto ? (l) => (
          <Stack direction="row" gap="tight">
            <Button size="icon" variant="ghost" aria-label={`Editar ${l.nomeProduto}`} onClick={() => void abrir(l)}>
              <Pencil />
            </Button>
            <Button size="icon" variant="ghost" tone="destructive" aria-label={`Excluir ${l.nomeProduto}`} onClick={() => void excluir(l)}>
              <Trash2 />
            </Button>
          </Stack>
        ) : undefined}
      />
    </Stack>
  );
}

const SituacaoBadge = ({ situacao }: { situacao: "verde" | "vermelho" }) => (
  <Badge variant={situacao === "verde" ? "success" : "destructive"}>{situacao === "verde" ? "Conforme" : "Divergente"}</Badge>
);

function Conferencia({ contexto }: { contexto: Contexto }) {
  const { feedback } = useUi();
  const periodos = contexto.periodosConferencia ?? [];
  const [periodoId, setPeriodoId] = useState(periodos[0]?.id ?? "");
  const [loja, setLoja] = useState(TODAS);
  const [linhas, setLinhas] = useState<LinhaConferencia[]>([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!periodoId) return;
    const consulta = new URLSearchParams({ periodoId });
    if (loja !== TODAS) consulta.set("codigoLoja", loja);
    setCarregando(true);
    apiFetch<LinhaConferencia[]>(`${BASE}/conferencia?${consulta}`)
      .then(setLinhas)
      .catch((err: unknown) => feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar a Conferência.")))
      .finally(() => setCarregando(false));
  }, [periodoId, loja, feedback]);

  const colunas = useMemo<DataTableColumn<LinhaConferencia>[]>(
    () => [
      { key: "colaborador", label: "Colaborador", value: (l) => l.nomeColaborador, searchable: true, sortable: true },
      { key: "produtos", label: "Produtos lançados", value: (l) => l.produtos, format: "number", sortable: true },
      { key: "lancada", label: "Qtde lançada", value: (l) => l.quantidadeLancada, format: "number", sortable: true },
      { key: "vendida", label: "Qtde vendida (todas as Lojas)", value: (l) => l.quantidadeVendida, format: "number", sortable: true },
      {
        key: "situacao",
        centered: true,
        label: "Situação",
        value: (l) => l.produtosConformes / l.produtos,
        render: (l) => <SituacaoBadge situacao={l.situacao} />,
        sortable: true,
      },
    ],
    [],
  );

  return (
    <Stack gap="section">
      <Stack direction="row" align="end" gap="section" wrap>
        <SeletorPeriodo periodos={periodos} valor={periodoId} onChange={setPeriodoId} />
        <Stack gap="field">
          <Label>Loja</Label>
          <Select value={loja} onValueChange={(v) => v && setLoja(v)}>
            <SelectTrigger aria-label="Loja">
              <SelectValue>{(v: string) => (v === TODAS ? "Todas as Lojas" : (contexto.lojasConferencia ?? []).find((l) => String(l.codigo) === v)?.nome || "Selecione")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Todas as Lojas</SelectItem>
              {(contexto.lojasConferencia ?? []).map((l) => (
                <SelectItem key={l.codigo} value={String(l.codigo)}>
                  {l.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Stack>
      </Stack>
      <DataTable
        scroll="page"
        columns={colunas}
        rows={linhas}
        getRowId={(l) => String(l.codigoColaborador)}
        loading={carregando}
        title="Conferência"
        description="O lançado por cada Colaborador contra o que ele vendeu no período, em todas as Lojas."
        emptyMessage="Nenhum lançamento neste período."
        search={{ placeholder: "Buscar Colaborador" }}
        renderExpanded={(l) => (
          <DataTable
            scroll="page"
            columns={[
              { key: "produto", label: "Produto", value: (d: DetalheConferencia) => d.nomeProduto },
              { key: "validades", centered: true, label: "Validade", value: (d: DetalheConferencia) => d.validades.map(validadeLabel).join(", ") },
              { key: "lancada", label: "Lançado", value: (d: DetalheConferencia) => d.quantidadeLancada, format: "number" },
              { key: "vendida", label: "Vendido", value: (d: DetalheConferencia) => d.quantidadeVendida, format: "number" },
              { key: "situacao", centered: true, label: "Situação", render: (d: DetalheConferencia) => <SituacaoBadge situacao={d.situacao} /> },
            ]}
            rows={l.detalhe}
            getRowId={(d) => d.produtoId}
          />
        )}
      />
    </Stack>
  );
}

/** Tela Pré-vencidos: o Estoque de cada Loja e as Baixas que as vendas fazem nele; o vendedor lança os seus; o gestor confere o declarado com as vendas do ERP. */
export function PreVencidosPage() {
  const { feedback } = useUi();
  const [contexto, setContexto] = useState<Contexto | null>(null);
  const [aba, setAba] = useTabParam<"estoque" | "baixas" | "lancamentos" | "conferencia">(
    contexto ? [contexto.podeEstoque && "estoque", contexto.podeBaixas && "baixas", contexto.podeLancar && "lancamentos", contexto.podeConferir && "conferencia"] : [],
  );

  useEffect(() => {
    apiFetch<Contexto>(`${BASE}/contexto`)
      .then(setContexto)
      .catch((err: unknown) => feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar os Pré-vencidos.")));
  }, [feedback]);

  if (!contexto || !aba) return null;
  return (
    <Stack gap="section">
      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          {contexto.podeEstoque && <TabsTrigger value="estoque">Estoque</TabsTrigger>}
          {contexto.podeBaixas && <TabsTrigger value="baixas">Baixas</TabsTrigger>}
          {contexto.podeLancar && <TabsTrigger value="lancamentos">Meus Lançamentos</TabsTrigger>}
          {contexto.podeConferir && <TabsTrigger value="conferencia">Conferência</TabsTrigger>}
        </TabsList>
      </Tabs>
      {aba === "estoque" ? (
        <EstoquePreVencidosTab lojas={contexto.lojasEstoque ?? []} />
      ) : aba === "baixas" ? (
        <BaixasPreVencidosTab lojas={contexto.lojasBaixas ?? []} periodos={contexto.periodos} />
      ) : aba === "lancamentos" ? (
        <MeusLancamentos contexto={contexto} />
      ) : (
        <Conferencia contexto={contexto} />
      )}
    </Stack>
  );
}
