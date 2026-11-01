import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Button } from "@platform/ui/components/button";
import { Label } from "@platform/ui/components/label";
import { Stack } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Tabs, TabsList, TabsTrigger } from "@platform/ui/components/tabs";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { formatDate } from "@platform/ui/lib/format";
import { AvaliacaoWindow, type Avaliacao, type LojaOpcao } from "./avaliacao-window";

const BASE = "/api/m/inovafarma/avaliacoes";
const TODAS = "todas";

interface Periodo {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status?: "open" | "closed";
}

interface Contexto {
  podeVer: boolean;
  podeGerenciar: boolean;
  todasAsLojas: boolean;
  vinculado: boolean;
  /** Closing Periods, o de data mais recente primeiro; só os abertos aceitam lançar, editar e excluir. */
  periodos: Periodo[];
  lojas: LojaOpcao[];
  lojasGerenciadas: LojaOpcao[];
}

interface LinhaColaborador {
  codigoColaborador: number;
  nomeColaborador: string;
  quantidade: number;
  total: number;
  avaliacoes: Avaliacao[];
}

const periodoLabel = (p: Periodo) => `${p.name} (${formatDate(p.startDate)} a ${formatDate(p.endDate)})${p.status === "closed" ? " · fechado" : ""}`;
const periodoInicial = (periodos: Periodo[]) => (periodos.find((p) => p.status !== "closed") ?? periodos[0])?.id ?? "";
const somar = (avaliacoes: Avaliacao[]) => avaliacoes.reduce((total, a) => total + a.valor, 0);

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

/** Lista as Avaliações de `url`; só a resposta da última consulta vale. */
function useAvaliacoes(url: string | null) {
  const { feedback } = useUi();
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([]);
  const [carregando, setCarregando] = useState(false);
  const consulta = useRef(0);
  const carregar = useCallback(async () => {
    if (!url) return;
    const minha = ++consulta.current;
    setCarregando(true);
    try {
      const recebidas = await apiFetch<Avaliacao[]>(url);
      if (minha === consulta.current) setAvaliacoes(recebidas);
    } catch (err: unknown) {
      if (minha === consulta.current) feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar as Avaliações."));
    } finally {
      if (minha === consulta.current) setCarregando(false);
    }
  }, [url, feedback]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  return { avaliacoes, carregando, carregar };
}

function SemPeriodo() {
  return (
    <Alert>
      <AlertTitle>Nenhum Período de Fechamento</AlertTitle>
      <AlertDescription>As Avaliações são lançadas em um Período de Fechamento aberto.</AlertDescription>
    </Alert>
  );
}

function MinhasAvaliacoes({ contexto }: { contexto: Contexto }) {
  const [periodoId, setPeriodoId] = useState(periodoInicial(contexto.periodos));
  const { avaliacoes, carregando } = useAvaliacoes(contexto.vinculado && periodoId ? `${BASE}/minhas?periodoId=${encodeURIComponent(periodoId)}` : null);

  if (!contexto.vinculado) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Sem vínculo</AlertTitle>
        <AlertDescription>Seu usuário não está vinculado a um Colaborador. Peça o vínculo a quem administra os Colaboradores.</AlertDescription>
      </Alert>
    );
  }
  if (contexto.periodos.length === 0) return <SemPeriodo />;

  const nomeLoja = (codigo: number) => contexto.lojas.find((l) => l.codigo === codigo)?.nome || `Loja ${codigo}`;
  const colunas: DataTableColumn<Avaliacao>[] = [
    { key: "data", label: "Data", value: (a) => a.criadoEm, format: "date", sortable: true },
    { key: "loja", label: "Loja", value: (a) => nomeLoja(a.codigoLoja), sortable: true },
    { key: "descricao", label: "Descrição", value: (a) => a.descricao, searchable: true },
    { key: "valor", label: "Valor descontado (R$)", value: (a) => a.valor, format: "currency", sortable: true },
  ];

  return (
    <Stack gap="section">
      <SeletorPeriodo periodos={contexto.periodos} valor={periodoId} onChange={setPeriodoId} />
      <DataTable
        columns={colunas}
        rows={avaliacoes}
        getRowId={(a) => a.id}
        loading={carregando}
        title="Minhas Avaliações"
        emptyMessage="Nenhuma Avaliação neste período."
        totals={(linhas) => ({ valor: somar(linhas) })}
      />
    </Stack>
  );
}

function AvaliacoesDaLoja({ contexto }: { contexto: Contexto }) {
  const { feedback, windows } = useUi();
  const [periodoId, setPeriodoId] = useState(periodoInicial(contexto.periodos));
  const [loja, setLoja] = useState(contexto.todasAsLojas || contexto.lojasGerenciadas.length !== 1 ? TODAS : String(contexto.lojasGerenciadas[0]!.codigo));
  const consulta = new URLSearchParams({ periodoId });
  if (loja !== TODAS) consulta.set("codigoLoja", loja);
  const { avaliacoes, carregando, carregar } = useAvaliacoes(periodoId ? `${BASE}?${consulta}` : null);

  const linhas = useMemo<LinhaColaborador[]>(() => {
    const porColaborador = new Map<number, Avaliacao[]>();
    for (const a of avaliacoes) porColaborador.set(a.codigoColaborador, [...(porColaborador.get(a.codigoColaborador) ?? []), a]);
    return [...porColaborador.values()].map((lista) => ({
      codigoColaborador: lista[0]!.codigoColaborador,
      nomeColaborador: lista[0]!.nomeColaborador,
      quantidade: lista.length,
      total: somar(lista),
      avaliacoes: lista,
    }));
  }, [avaliacoes]);

  if (!contexto.todasAsLojas && contexto.lojasGerenciadas.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Sem Loja</AlertTitle>
        <AlertDescription>Seu usuário não está vinculado a uma Loja. Peça o vínculo a quem administra os Colaboradores.</AlertDescription>
      </Alert>
    );
  }
  if (contexto.periodos.length === 0) return <SemPeriodo />;
  const aberto = contexto.periodos.find((p) => p.id === periodoId)?.status !== "closed";

  const abrir = async (avaliacao?: Avaliacao) => {
    const resultado = await windows.open<Avaliacao>({
      surface: "dialog",
      size: "small",
      title: avaliacao ? "Editar Avaliação" : "Nova Avaliação",
      description: avaliacao ? avaliacao.nomeColaborador : "Avalie um Colaborador da sua Loja.",
      content: () => <AvaliacaoWindow periodoId={periodoId} lojas={contexto.lojasGerenciadas} avaliacao={avaliacao} />,
    });
    if (resultado.status === "confirmed") void carregar();
  };

  const excluir = async (avaliacao: Avaliacao) => {
    const ok = await windows.confirm({
      title: "Excluir Avaliação",
      description: `Excluir a Avaliação de ${avaliacao.nomeColaborador}: "${avaliacao.descricao}"?`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`${BASE}/${avaliacao.id}?version=${avaliacao.version}`, { method: "DELETE" });
      feedback.notify({ type: "success", title: "Avaliação excluída." });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao excluir a Avaliação."));
    }
    void carregar();
  };

  const nomeLoja = (codigo: number) => contexto.lojas.find((l) => l.codigo === codigo)?.nome || `Loja ${codigo}`;
  const colunas: DataTableColumn<LinhaColaborador>[] = [
    { key: "colaborador", label: "Colaborador", value: (l) => l.nomeColaborador, searchable: true, sortable: true },
    { key: "quantidade", label: "Qtde de Avaliações", value: (l) => l.quantidade, format: "number", sortable: true },
    { key: "total", label: "Total descontado (R$)", value: (l) => l.total, format: "currency", sortable: true },
  ];
  const colunasDetalhe: DataTableColumn<Avaliacao>[] = [
    { key: "data", label: "Data", value: (a) => a.criadoEm, format: "date" },
    { key: "loja", label: "Loja", value: (a) => nomeLoja(a.codigoLoja) },
    { key: "descricao", label: "Descrição", value: (a) => a.descricao },
    { key: "lancadoPor", label: "Lançado por", value: (a) => a.lancadoPor ?? "" },
    { key: "valor", label: "Valor (R$)", value: (a) => a.valor, format: "currency" },
  ];

  return (
    <Stack gap="section">
      <Stack direction="row" align="end" justify="between" gap="section" wrap>
        <Stack direction="row" align="end" gap="section" wrap>
          <SeletorPeriodo periodos={contexto.periodos} valor={periodoId} onChange={setPeriodoId} />
          <Stack gap="field">
            <Label>Loja</Label>
            <Select value={loja} onValueChange={(v) => v && setLoja(v)}>
              <SelectTrigger aria-label="Loja">
                <SelectValue>{(v: string) => (v === TODAS ? "Todas as Lojas" : contexto.lojasGerenciadas.find((l) => String(l.codigo) === v)?.nome || `Loja ${v}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todas as Lojas</SelectItem>
                {contexto.lojasGerenciadas.map((l) => (
                  <SelectItem key={l.codigo} value={String(l.codigo)}>
                    {l.nome || `Loja ${l.codigo}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Stack>
        </Stack>
        <Button disabled={!aberto} onClick={() => void abrir()}>
          <Plus />
          Nova Avaliação
        </Button>
      </Stack>
      {!aberto && (
        <Alert>
          <AlertTitle>Período fechado</AlertTitle>
          <AlertDescription>Neste período você só consulta as Avaliações. Para lançar, escolha um Período de Fechamento aberto.</AlertDescription>
        </Alert>
      )}
      <DataTable
        columns={colunas}
        rows={linhas}
        getRowId={(l) => String(l.codigoColaborador)}
        loading={carregando}
        title="Avaliações da Loja"
        emptyMessage="Nenhuma Avaliação neste período."
        search={{ placeholder: "Buscar Colaborador" }}
        totals={(filtradas) => ({ quantidade: filtradas.reduce((n, l) => n + l.quantidade, 0), total: filtradas.reduce((n, l) => n + l.total, 0) })}
        renderExpanded={(l) => (
          <DataTable
            columns={colunasDetalhe}
            rows={l.avaliacoes}
            getRowId={(a) => a.id}
            rowActions={
              aberto
                ? (a) => (
                    <Stack direction="row" gap="tight">
                      <Button size="icon" variant="ghost" aria-label={`Editar Avaliação de ${a.nomeColaborador}`} onClick={() => void abrir(a)}>
                        <Pencil />
                      </Button>
                      <Button size="icon" variant="ghost" tone="destructive" aria-label={`Excluir Avaliação de ${a.nomeColaborador}`} onClick={() => void excluir(a)}>
                        <Trash2 />
                      </Button>
                    </Stack>
                  )
                : undefined
            }
          />
        )}
      />
    </Stack>
  );
}

/** Tela Avaliações: o Colaborador vê as que recebeu; o gestor lança e gerencia as da sua Loja. */
export function AvaliacoesPage() {
  const { feedback } = useUi();
  const [contexto, setContexto] = useState<Contexto | null>(null);
  const [aba, setAba] = useState<"minhas" | "loja" | null>(null);

  useEffect(() => {
    apiFetch<Contexto>(`${BASE}/contexto`)
      .then(setContexto)
      .catch((err: unknown) => feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar as Avaliações.")));
  }, [feedback]);

  if (!contexto) return null;
  const abaAtual = aba ?? (contexto.podeVer ? "minhas" : "loja");
  return (
    <Stack gap="section">
      <Tabs value={abaAtual} onValueChange={(v) => setAba(v === "loja" ? "loja" : "minhas")}>
        <TabsList>
          {contexto.podeVer && <TabsTrigger value="minhas">Minhas Avaliações</TabsTrigger>}
          {contexto.podeGerenciar && <TabsTrigger value="loja">Avaliações da Loja</TabsTrigger>}
        </TabsList>
      </Tabs>
      {abaAtual === "minhas" ? <MinhasAvaliacoes contexto={contexto} /> : <AvaliacoesDaLoja contexto={contexto} />}
    </Stack>
  );
}
