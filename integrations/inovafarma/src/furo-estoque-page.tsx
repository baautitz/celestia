import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, MessageSquarePlus, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { Label } from "@platform/ui/components/label";
import { Grid, KpiCard, Stack, Text } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Tabs, TabsList, TabsTrigger } from "@platform/ui/components/tabs";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { HeaderActions } from "@platform/ui/context/header-actions";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { formatCurrency, formatDate, formatNumber } from "@platform/ui/lib/format";
import { BASE, JustificativaWindow, MotivoWindow, type Justificativa, type Motivo } from "./furo-estoque-window";

const TODAS = "todas";

interface Periodo {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status?: "open" | "closed";
}

interface Loja {
  codigo: number;
  nome: string;
}

interface Contexto {
  todasAsLojas: boolean;
  podeGerenciarMotivos: boolean;
  periodos: Periodo[];
  lojas: Loja[];
  lojasGerenciadas: Loja[];
  motivos: Motivo[];
}

interface Item {
  produtoId: string;
  nome: string;
  codigoBarra: string | null;
  quantidade: number;
  precoCusto: number;
  totalCusto: number;
}

export interface Ajuste {
  codigoMovimento: number;
  codigoLoja: number;
  data: string;
  operacao: "+" | "-";
  colaborador: string;
  usuario: string;
  observacaoErp: string;
  quantidade: number;
  totalCusto: number;
  itens: Item[];
  justificativa: Justificativa | null;
}

type Situacao = "todos" | "pendentes" | "justificados";

const periodoLabel = (p: Periodo) => `${p.name} (${formatDate(p.startDate)} a ${formatDate(p.endDate)})${p.status === "closed" ? " · fechado" : ""}`;
const periodoInicial = (periodos: Periodo[]) => (periodos.find((p) => p.status !== "closed") ?? periodos[0])?.id ?? "";
/** `AAAA-MM-DD HH:mm` → `DD/MM/AAAA HH:mm`. */
const dataHora = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)} ${data.slice(11, 16)}`;
const somaCusto = (ajustes: Ajuste[]) => ajustes.reduce((n, a) => n + a.totalCusto, 0);

function AjustesDoPeriodo({ contexto, motivos }: { contexto: Contexto; motivos: Motivo[] }) {
  const { feedback, windows } = useUi();
  const [periodoId, setPeriodoId] = useState(periodoInicial(contexto.periodos));
  const [loja, setLoja] = useState(contexto.todasAsLojas || contexto.lojasGerenciadas.length !== 1 ? TODAS : String(contexto.lojasGerenciadas[0]!.codigo));
  const [situacao, setSituacao] = useState<Situacao>("pendentes");
  const [ajustes, setAjustes] = useState<Ajuste[]>([]);
  const [carregando, setCarregando] = useState(false);
  const consulta = useRef(0);

  const carregar = useCallback(async () => {
    if (!periodoId) return;
    const minha = ++consulta.current;
    const params = new URLSearchParams({ periodoId });
    if (loja !== TODAS) params.set("codigoLoja", loja);
    setCarregando(true);
    try {
      const recebidos = await apiFetch<Ajuste[]>(`${BASE}/ajustes?${params}`);
      if (minha === consulta.current) setAjustes(recebidos);
    } catch (err: unknown) {
      if (minha === consulta.current) {
        setAjustes([]);
        feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar os Ajustes de Estoque."));
      }
    } finally {
      if (minha === consulta.current) setCarregando(false);
    }
  }, [periodoId, loja, feedback]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const pendentes = useMemo(() => ajustes.filter((a) => !a.justificativa), [ajustes]);
  const justificados = useMemo(() => ajustes.filter((a) => a.justificativa), [ajustes]);
  const visiveis = situacao === "pendentes" ? pendentes : situacao === "justificados" ? justificados : ajustes;

  if (!contexto.todasAsLojas && contexto.lojasGerenciadas.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Sem Loja</AlertTitle>
        <AlertDescription>Seu usuário não está vinculado a uma Loja. Peça o vínculo a quem administra os Colaboradores.</AlertDescription>
      </Alert>
    );
  }
  if (contexto.periodos.length === 0) {
    return (
      <Alert>
        <AlertTitle>Nenhum Período de Fechamento</AlertTitle>
        <AlertDescription>Os Ajustes de Estoque são listados e justificados por Período de Fechamento.</AlertDescription>
      </Alert>
    );
  }
  const aberto = contexto.periodos.find((p) => p.id === periodoId)?.status !== "closed";
  const nomeLoja = (codigo: number) => contexto.lojas.find((l) => l.codigo === codigo)?.nome || `Loja ${codigo}`;

  const justificar = async (ajuste: Ajuste) => {
    const resultado = await windows.open<true>({
      surface: "dialog",
      size: "small",
      title: ajuste.justificativa ? "Alterar Justificativa" : "Justificar Ajuste",
      description: `Ajuste ${ajuste.codigoMovimento} · ${nomeLoja(ajuste.codigoLoja)} · ${formatCurrency(ajuste.totalCusto)}`,
      content: () => <JustificativaWindow periodoId={periodoId} codigoMovimento={ajuste.codigoMovimento} motivos={motivos} justificativa={ajuste.justificativa} />,
    });
    if (resultado.status === "confirmed") void carregar();
  };

  const excluir = async (ajuste: Ajuste) => {
    const j = ajuste.justificativa;
    if (!j) return;
    const ok = await windows.confirm({
      title: "Excluir Justificativa",
      description: `Excluir a Justificativa "${j.motivo}" do Ajuste ${ajuste.codigoMovimento}? Ele volta a contar como não justificado.`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`${BASE}/justificativas/${j.id}?version=${j.version}`, { method: "DELETE" });
      feedback.notify({ type: "success", title: "Justificativa excluída." });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao excluir a Justificativa."));
    }
    void carregar();
  };

  const colunas: DataTableColumn<Ajuste>[] = [
    { key: "data", label: "Data", value: (a) => a.data, render: (a) => dataHora(a.data), sortable: true, nowrap: true, mobileRole: "secondary" },
    { key: "codigoMovimento", label: "Ajuste", tooltip: "Número da movimentação no InovaFarma.", value: (a) => a.codigoMovimento, searchable: true, sortable: true, cellClassName: "font-mono text-xs" },
    { key: "loja", label: "Loja", value: (a) => nomeLoja(a.codigoLoja), sortable: true },
    { key: "colaborador", label: "Lançado por", tooltip: "Colaborador informado no Ajuste, no InovaFarma.", value: (a) => a.colaborador, searchable: true, sortable: true },
    { key: "quantidade", label: "Qtde", value: (a) => a.quantidade, format: "number", sortable: true },
    {
      key: "totalCusto",
      label: "Custo (R$)",
      tooltip: "Custo dos itens no Ajuste: negativo nas saídas, positivo nas entradas.",
      value: (a) => a.totalCusto,
      format: "currency",
      sortable: true,
      cellClassName: (a) => (a.totalCusto < 0 ? "text-destructive" : undefined),
    },
    {
      key: "justificativa",
      label: "Justificativa",
      value: (a) => a.justificativa?.motivo ?? "",
      searchable: true,
      sortable: true,
      mobileRole: "primary",
      render: (a) =>
        a.justificativa ? (
          <Stack direction="row" gap="tight" align="center" wrap>
            <Badge variant="success">{a.justificativa.motivo}</Badge>
            <Text variant="caption" tone="muted">
              {[a.justificativa.observacao, a.justificativa.justificadoPor && `por ${a.justificativa.justificadoPor}`].filter(Boolean).join(" · ")}
            </Text>
          </Stack>
        ) : (
          <Badge variant="warning">Não justificado</Badge>
        ),
    },
  ];

  const colunasItens: DataTableColumn<Item>[] = [
    { key: "nome", label: "Produto", value: (i) => i.nome },
    { key: "codigoBarra", label: "Código de barras", value: (i) => i.codigoBarra ?? "", cellClassName: "font-mono text-xs" },
    { key: "quantidade", label: "Qtde", value: (i) => i.quantidade, format: "number" },
    { key: "precoCusto", label: "Custo unit. (R$)", value: (i) => i.precoCusto, format: "currency" },
    { key: "totalCusto", label: "Custo (R$)", value: (i) => i.totalCusto, format: "currency" },
  ];

  return (
    <Stack gap="section">
      <Stack direction="row" align="end" gap="section" wrap>
        <Stack gap="field">
          <Label>Período de Fechamento</Label>
          <Select value={periodoId} onValueChange={(v) => v && setPeriodoId(v)}>
            <SelectTrigger aria-label="Período de Fechamento">
              <SelectValue>{(id: string) => contexto.periodos.find((p) => p.id === id)?.name ?? "Selecione"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {contexto.periodos.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {periodoLabel(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Stack>
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
        <Stack gap="field">
          <Label>Situação</Label>
          <Select value={situacao} onValueChange={(v) => v && setSituacao(v as Situacao)}>
            <SelectTrigger aria-label="Situação">
              <SelectValue>{(v: string) => ({ todos: "Todos", pendentes: "Não justificados", justificados: "Justificados" })[v as Situacao]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pendentes">Não justificados</SelectItem>
              <SelectItem value="justificados">Justificados</SelectItem>
              <SelectItem value="todos">Todos</SelectItem>
            </SelectContent>
          </Select>
        </Stack>
      </Stack>

      {!aberto && (
        <Alert>
          <AlertTitle>Período fechado</AlertTitle>
          <AlertDescription>Neste período você só consulta as Justificativas. Para justificar, reabra o Período de Fechamento.</AlertDescription>
        </Alert>
      )}

      <Grid columns="cards">
        <KpiCard loading={carregando} label="Ajustes no período" value={formatNumber(ajustes.length)} hint={`Custo líquido ${formatCurrency(somaCusto(ajustes))}`} icon={<Package />} tone="info" />
        <KpiCard
          loading={carregando}
          label="Não justificados (furo)"
          value={formatCurrency(somaCusto(pendentes))}
          hint={`${formatNumber(pendentes.length)} ajustes sem Justificativa`}
          icon={<AlertTriangle />}
          tone="warning"
        />
        <KpiCard loading={carregando} label="Justificados" value={formatCurrency(somaCusto(justificados))} hint={`${formatNumber(justificados.length)} ajustes`} icon={<CheckCircle2 />} tone="success" />
      </Grid>

      <DataTable
        columns={colunas}
        rows={visiveis}
        getRowId={(a) => String(a.codigoMovimento)}
        loading={carregando}
        title="Ajustes de Estoque"
        emptyMessage={situacao === "pendentes" ? "Nenhum Ajuste de Estoque sem Justificativa neste período." : "Nenhum Ajuste de Estoque neste período."}
        search={{ placeholder: "Buscar Ajuste, Colaborador ou Motivo" }}
        totals={(linhas) => ({ quantidade: linhas.reduce((n, a) => n + a.quantidade, 0), totalCusto: somaCusto(linhas) })}
        renderExpanded={(a) => (
          <Stack gap="field">
            <Text variant="small" tone="muted">
              Observação no ERP: {a.observacaoErp || "sem observação"}
            </Text>
            <DataTable columns={colunasItens} rows={a.itens} getRowId={(i) => i.produtoId} />
          </Stack>
        )}
        rowActions={
          aberto
            ? (a) => (
                <Stack direction="row" gap="tight">
                  <Button size="icon" variant="ghost" aria-label={a.justificativa ? `Alterar Justificativa do Ajuste ${a.codigoMovimento}` : `Justificar Ajuste ${a.codigoMovimento}`} onClick={() => void justificar(a)}>
                    {a.justificativa ? <Pencil /> : <MessageSquarePlus />}
                  </Button>
                  {a.justificativa && (
                    <Button size="icon" variant="ghost" tone="destructive" aria-label={`Excluir Justificativa do Ajuste ${a.codigoMovimento}`} onClick={() => void excluir(a)}>
                      <Trash2 />
                    </Button>
                  )}
                </Stack>
              )
            : undefined
        }
      />
    </Stack>
  );
}

function Motivos({ motivos, recarregar }: { motivos: Motivo[]; recarregar: () => void }) {
  const { windows } = useUi();
  const abrir = async (motivo?: Motivo) => {
    const resultado = await windows.open<true>({
      surface: "dialog",
      size: "small",
      title: motivo ? "Alterar Motivo" : "Novo Motivo",
      content: () => <MotivoWindow motivo={motivo} />,
    });
    if (resultado.status === "confirmed") recarregar();
  };
  const colunas: DataTableColumn<Motivo>[] = [
    { key: "nome", label: "Motivo", value: (m) => m.nome, searchable: true, sortable: true },
    { key: "ativo", label: "Situação", value: (m) => (m.ativo ? "Ativo" : "Inativo"), render: (m) => <Badge variant={m.ativo ? "success" : "secondary"}>{m.ativo ? "Ativo" : "Inativo"}</Badge> },
  ];
  return (
    <Stack gap="section">
      <HeaderActions>
        <Button onClick={() => void abrir()}>
          <Plus />
          Novo Motivo
        </Button>
      </HeaderActions>
      <DataTable
        columns={colunas}
        rows={motivos}
        getRowId={(m) => m.id}
        title="Motivos do Ajuste"
        description="Um Motivo inativo não aparece para novas Justificativas, mas continua nas que já o usam."
        rowActions={(m) => (
          <Button size="icon" variant="ghost" aria-label={`Alterar Motivo ${m.nome}`} onClick={() => void abrir(m)}>
            <Pencil />
          </Button>
        )}
      />
    </Stack>
  );
}

/** Tela Furo de Estoque: Ajustes de Estoque do InovaFarma por Período de Fechamento, com as Justificativas. */
export function FuroEstoquePage() {
  const { feedback } = useUi();
  const [contexto, setContexto] = useState<Contexto | null>(null);
  const [aba, setAba] = useState<"ajustes" | "motivos">("ajustes");

  const carregar = useCallback(() => {
    apiFetch<Contexto>(`${BASE}/contexto`)
      .then(setContexto)
      .catch((err: unknown) => feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar o Furo de Estoque.")));
  }, [feedback]);
  useEffect(carregar, [carregar]);

  if (!contexto) return null;
  return (
    <Stack gap="section">
      {contexto.podeGerenciarMotivos && (
        <Tabs value={aba} onValueChange={(v) => setAba(v === "motivos" ? "motivos" : "ajustes")}>
          <TabsList>
            <TabsTrigger value="ajustes">Ajustes de Estoque</TabsTrigger>
            <TabsTrigger value="motivos">Motivos</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {aba === "motivos" && contexto.podeGerenciarMotivos ? (
        <Motivos motivos={contexto.motivos} recarregar={carregar} />
      ) : (
        <AjustesDoPeriodo contexto={contexto} motivos={contexto.motivos} />
      )}
    </Stack>
  );
}
