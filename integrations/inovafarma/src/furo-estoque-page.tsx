import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDownToLine, CheckCircle2, Eye, MessageSquarePlus, Pencil, Plus, Trash2, MoreHorizontal } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@platform/ui/components/dropdown-menu";
import { Label } from "@platform/ui/components/label";
import { Grid, KpiCard, Show, Stack, Text } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Tabs, TabsList, TabsTrigger } from "@platform/ui/components/tabs";
import { useTabParam } from "@platform/ui/hooks/use-tab-param";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { HeaderActions } from "@platform/ui/context/header-actions";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { formatCurrency, formatDate, formatNumber } from "@platform/ui/lib/format";
import { BASE, JustificativaWindow, MotivoWindow, VerJustificativaWindow, type Justificativa, type Motivo } from "./furo-estoque-window";

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

/** Grupo de Ajustes de um card; sem grupo escolhido, a tabela mostra todos. */
type Grupo = "furo" | "entradas" | "justificados";

const periodoLabel = (p: Periodo) => `${p.name} (${formatDate(p.startDate)} a ${formatDate(p.endDate)})${p.status === "closed" ? " · fechado" : ""}`;
const periodoInicial = (periodos: Periodo[]) => (periodos.find((p) => p.status !== "closed") ?? periodos[0])?.id ?? "";
/** `AAAA-MM-DD HH:mm` → `DD/MM/AAAA HH:mm`. */
const dataHora = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)} ${data.slice(11, 16)}`;
const somaCusto = (ajustes: Ajuste[]) => ajustes.reduce((n, a) => n + a.totalCusto, 0);
/** Soma sem sinal, para os cards: o sentido já está no nome do card. */
const somaAbsoluta = (ajustes: Ajuste[]) => ajustes.reduce((n, a) => n + Math.abs(a.totalCusto), 0);

function AjustesDoPeriodo({ contexto, motivos }: { contexto: Contexto; motivos: Motivo[] }) {
  const { feedback, windows } = useUi();
  const [periodoId, setPeriodoId] = useState(periodoInicial(contexto.periodos));
  const [loja, setLoja] = useState(contexto.todasAsLojas || contexto.lojasGerenciadas.length !== 1 ? TODAS : String(contexto.lojasGerenciadas[0]!.codigo));
  const [grupo, setGrupo] = useState<Grupo | null>("furo");
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

  const grupos = useMemo(
    () => ({
      furo: ajustes.filter((a) => !a.justificativa && a.operacao === "-"),
      entradas: ajustes.filter((a) => !a.justificativa && a.operacao === "+"),
      justificados: ajustes.filter((a) => a.justificativa),
    }),
    [ajustes],
  );
  const visiveis = grupo ? grupos[grupo] : ajustes;
  const alternar = (g: Grupo) => setGrupo((atual) => (atual === g ? null : g));

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

  const verJustificativa = async (ajuste: Ajuste) => {
    if (!ajuste.justificativa) return;
    await windows.open({
      surface: "dialog",
      size: "small",
      title: "Justificativa",
      description: `Ajuste ${ajuste.codigoMovimento} · ${nomeLoja(ajuste.codigoLoja)} · ${formatCurrency(ajuste.totalCusto)}`,
      content: () => <VerJustificativaWindow justificativa={ajuste.justificativa!} />,
    });
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
    { key: "data", centered: true, label: "Data", value: (a) => a.data, render: (a) => dataHora(a.data), sortable: true, nowrap: true, mobileRole: "secondary" },
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
      centered: true,
      label: "Justificativa",
      value: (a) => a.justificativa?.motivo ?? "",
      searchable: true,
      sortable: true,
      mobileRole: "primary",
      render: (a) =>
        a.justificativa ? (
          <Stack direction="row" gap="tight" align="center" justify="center">
            <Badge variant="success">{a.justificativa.motivo}</Badge>
            <Button size="icon" variant="ghost" aria-label={`Ver Justificativa do Ajuste ${a.codigoMovimento}`} onClick={() => void verJustificativa(a)}>
              <Eye />
            </Button>
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
      </Stack>

      {!aberto && (
        <Alert>
          <AlertTitle>Período fechado</AlertTitle>
          <AlertDescription>Neste período você só consulta as Justificativas. Para justificar, reabra o Período de Fechamento.</AlertDescription>
        </Alert>
      )}

      <Grid columns="cards">
        <KpiCard
          loading={carregando}
          label="Furo"
          value={formatCurrency(somaAbsoluta(grupos.furo))}
          hint={`${formatNumber(grupos.furo.length)} ajustes de saída sem Justificativa`}
          icon={<AlertTriangle />}
          tone="warning"
          selected={grupo === "furo"}
          onSelect={() => alternar("furo")}
        />
        <KpiCard
          loading={carregando}
          label="Entradas não justificadas"
          value={formatCurrency(somaAbsoluta(grupos.entradas))}
          hint={`${formatNumber(grupos.entradas.length)} ajustes de entrada`}
          icon={<ArrowDownToLine />}
          tone="info"
          selected={grupo === "entradas"}
          onSelect={() => alternar("entradas")}
        />
        <KpiCard
          loading={carregando}
          label="Justificados"
          value={formatCurrency(somaAbsoluta(grupos.justificados))}
          hint={`${formatNumber(grupos.justificados.length)} de ${formatNumber(ajustes.length)} ajustes (${ajustes.length ? Math.round((grupos.justificados.length / ajustes.length) * 100) : 0}%)`}
          icon={<CheckCircle2 />}
          tone="success"
          selected={grupo === "justificados"}
          onSelect={() => alternar("justificados")}
        />
      </Grid>

      <DataTable
        scroll="page"
        columns={colunas}
        rows={visiveis}
        getRowId={(a) => String(a.codigoMovimento)}
        loading={carregando}
        title="Ajustes de Estoque"
        emptyMessage={
          grupo === "furo"
            ? "Nenhuma saída sem Justificativa neste período."
            : grupo === "entradas"
              ? "Nenhuma entrada sem Justificativa neste período."
              : grupo === "justificados"
                ? "Nenhum Ajuste justificado neste período."
                : "Nenhum Ajuste de Estoque neste período."
        }
        search={{ placeholder: "Buscar Ajuste, Colaborador, Motivo ou produto", fields: (a) => a.itens.flatMap((i) => [i.nome, i.codigoBarra ?? ""]) }}
        totals={(linhas) => ({ quantidade: linhas.reduce((n, a) => n + a.quantidade, 0), totalCusto: somaCusto(linhas) })}
        renderExpanded={(a) => (
          <Stack gap="field">
            <Text variant="small" tone="muted">
              Observação no ERP: {a.observacaoErp || "sem observação"}
            </Text>
            <DataTable scroll="page" columns={colunasItens} rows={a.itens} getRowId={(i) => i.produtoId} />
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
    { key: "ativo", centered: true, label: "Situação", value: (m) => (m.ativo ? "Ativo" : "Inativo"), render: (m) => <Badge variant={m.ativo ? "success" : "secondary"}>{m.ativo ? "Ativo" : "Inativo"}</Badge> },
  ];
  return (
    <Stack gap="section">
      <HeaderActions>
        <Show on="lgUp">
          <Button onClick={() => void abrir()}>
            <Plus />
            Novo Motivo
          </Button>
        </Show>
        <Show on="belowLg">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Mais ações" />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void abrir()}>
                <Plus />
                Novo Motivo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Show>
      </HeaderActions>
      <DataTable
        scroll="page"
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
  const [aba, setAba] = useTabParam<"ajustes" | "motivos">(contexto ? ["ajustes", contexto.podeGerenciarMotivos && "motivos"] : []);

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
        <Tabs value={aba} onValueChange={setAba}>
          <TabsList>
            <TabsTrigger value="ajustes">Ajustes de Estoque</TabsTrigger>
            <TabsTrigger value="motivos">Motivos</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {aba === "motivos" ? (
        <Motivos motivos={contexto.motivos} recarregar={carregar} />
      ) : (
        <AjustesDoPeriodo contexto={contexto} motivos={contexto.motivos} />
      )}
    </Stack>
  );
}
