import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { Label } from "@platform/ui/components/label";
import { Stack, Text } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Tabs, TabsList, TabsTrigger } from "@platform/ui/components/tabs";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { formatDate, formatNumber } from "@platform/ui/lib/format";
import { LancamentoWindow, type Lancamento, type LojaOpcao } from "./pre-vencido-window";

const BASE = "/api/m/inovafarma/pre-vencidos";
const TODAS = "todas";

interface Periodo {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

interface Contexto {
  podeLancar: boolean;
  podeConferir: boolean;
  vinculado: boolean;
  /** Closing Periods abertos, o de data mais recente primeiro. */
  periodos: Periodo[];
  lojas: LojaOpcao[];
  periodosConferencia?: Periodo[];
  lojasConferencia?: LojaOpcao[];
  colaboradores?: { codigo: number; nome: string }[];
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
const periodoLabel = (p: Periodo) => `${p.name} (${formatDate(p.startDate)} a ${formatDate(p.endDate)})`;

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
  const [periodoId, setPeriodoId] = useState(contexto.periodos[0]?.id ?? "");
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
        <AlertTitle>Nenhum Período de Fechamento aberto</AlertTitle>
        <AlertDescription>Os lançamentos só podem ser feitos em um Período de Fechamento aberto.</AlertDescription>
      </Alert>
    );
  }

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
    { key: "validade", label: "Validade", value: (l) => l.validade, render: (l) => validadeLabel(l.validade), sortable: true },
  ];

  return (
    <Stack gap="section">
      <Stack direction="row" align="end" justify="between" gap="section" wrap>
        <SeletorPeriodo periodos={contexto.periodos} valor={periodoId} onChange={setPeriodoId} />
        <Button onClick={() => void abrir()}>
          <Plus />
          Novo lançamento
        </Button>
      </Stack>
      <DataTable
        columns={colunas}
        rows={lancamentos}
        getRowId={(l) => l.id}
        loading={carregando}
        title="Meus lançamentos"
        emptyMessage="Nenhum lançamento neste período."
        search={{ placeholder: "Buscar produto" }}
        rowActions={(l) => (
          <Stack direction="row" gap="tight">
            <Button size="icon" variant="ghost" aria-label={`Editar ${l.nomeProduto}`} onClick={() => void abrir(l)}>
              <Pencil />
            </Button>
            <Button size="icon" variant="ghost" tone="destructive" aria-label={`Excluir ${l.nomeProduto}`} onClick={() => void excluir(l)}>
              <Trash2 />
            </Button>
          </Stack>
        )}
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
  const [colaborador, setColaborador] = useState(TODAS);
  const [linhas, setLinhas] = useState<LinhaConferencia[]>([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!periodoId) return;
    const consulta = new URLSearchParams({ periodoId });
    if (loja !== TODAS) consulta.set("codigoLoja", loja);
    if (colaborador !== TODAS) consulta.set("codigoColaborador", colaborador);
    setCarregando(true);
    apiFetch<LinhaConferencia[]>(`${BASE}/conferencia?${consulta}`)
      .then(setLinhas)
      .catch((err: unknown) => feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar a Conferência.")))
      .finally(() => setCarregando(false));
  }, [periodoId, loja, colaborador, feedback]);

  const colunas = useMemo<DataTableColumn<LinhaConferencia>[]>(
    () => [
      { key: "colaborador", label: "Colaborador", value: (l) => l.nomeColaborador, searchable: true, sortable: true },
      { key: "produtos", label: "Produtos lançados", value: (l) => l.produtos, format: "number", sortable: true },
      { key: "lancada", label: "Qtde lançada", value: (l) => l.quantidadeLancada, format: "number", sortable: true },
      { key: "vendida", label: "Qtde vendida (todas as Lojas)", value: (l) => l.quantidadeVendida, format: "number", sortable: true },
      {
        key: "situacao",
        label: "Situação",
        value: (l) => l.produtosConformes / l.produtos,
        render: (l) => (
          <Stack direction="row" align="center" gap="field">
            <SituacaoBadge situacao={l.situacao} />
            <Text>{`${l.produtosConformes} de ${l.produtos} conformes`}</Text>
          </Stack>
        ),
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
        <Stack gap="field">
          <Label>Colaborador</Label>
          <Select value={colaborador} onValueChange={(v) => v && setColaborador(v)}>
            <SelectTrigger aria-label="Colaborador">
              <SelectValue>{(v: string) => (v === TODAS ? "Todos os Colaboradores" : (contexto.colaboradores ?? []).find((c) => String(c.codigo) === v)?.nome || "Selecione")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Todos os Colaboradores</SelectItem>
              {(contexto.colaboradores ?? []).map((c) => (
                <SelectItem key={c.codigo} value={String(c.codigo)}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Stack>
      </Stack>
      <DataTable
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
            columns={[
              { key: "produto", label: "Produto", value: (d: DetalheConferencia) => d.nomeProduto },
              { key: "validades", label: "Validade", value: (d: DetalheConferencia) => d.validades.map(validadeLabel).join(", ") },
              { key: "lancada", label: "Lançado", value: (d: DetalheConferencia) => d.quantidadeLancada, render: (d: DetalheConferencia) => formatNumber(d.quantidadeLancada) },
              { key: "vendida", label: "Vendido", value: (d: DetalheConferencia) => d.quantidadeVendida, render: (d: DetalheConferencia) => formatNumber(d.quantidadeVendida) },
              { key: "situacao", label: "Situação", render: (d: DetalheConferencia) => <SituacaoBadge situacao={d.situacao} /> },
            ]}
            rows={l.detalhe}
            getRowId={(d) => d.produtoId}
          />
        )}
      />
    </Stack>
  );
}

/** Tela Pré-vencidos: o vendedor lança os seus; o gestor confere o declarado com as vendas do ERP. */
export function PreVencidosPage() {
  const { feedback } = useUi();
  const [contexto, setContexto] = useState<Contexto | null>(null);
  const [aba, setAba] = useState<"lancamentos" | "conferencia" | null>(null);

  useEffect(() => {
    apiFetch<Contexto>(`${BASE}/contexto`)
      .then(setContexto)
      .catch((err: unknown) => feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar os Pré-vencidos.")));
  }, [feedback]);

  if (!contexto) return null;
  const abaAtual = aba ?? (contexto.podeLancar ? "lancamentos" : "conferencia");
  return (
    <Stack gap="section">
      <Tabs value={abaAtual} onValueChange={(v) => setAba(v === "conferencia" ? "conferencia" : "lancamentos")}>
        <TabsList>
          {contexto.podeLancar && <TabsTrigger value="lancamentos">Meus Lançamentos</TabsTrigger>}
          {contexto.podeConferir && <TabsTrigger value="conferencia">Conferência</TabsTrigger>}
        </TabsList>
      </Tabs>
      {abaAtual === "lancamentos" ? <MeusLancamentos contexto={contexto} /> : <Conferencia contexto={contexto} />}
    </Stack>
  );
}
