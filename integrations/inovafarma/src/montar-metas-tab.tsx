import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Save, Target, Trash2, MoreHorizontal } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@platform/ui/components/alert";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@platform/ui/components/dropdown-menu";
import { Label } from "@platform/ui/components/label";
import { PairGrid, Show, Stack, Text } from "@platform/ui/components/layout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@platform/ui/components/select";
import { Switch } from "@platform/ui/components/switch";
import {
  DataTable,
  type DataTableColumn,
} from "@platform/ui/data-table/data-table";
import { HeaderActions } from "@platform/ui/context/header-actions";
import { useUi } from "@platform/ui/imperative/provider";
import {
  WindowActions,
  WindowCancelButton,
  useWindow,
} from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { AlvoInput, rotuloAlvo } from "./alvo-input";
import { DefinirAlvoWindow } from "./alvo-padrao-window";
import { formatarValor, indicadorPorId, type IndicadorId } from "./indicadores";
import { indicadorDoTipo } from "./tipos-meta";
import { regraDoParticipante } from "./apuracao";
import {
  PremioParticipanteWindow,
  resumoPremio,
} from "./premio-participante-window";
import type { Meta } from "./metas-store";
import { usaAlvo } from "./montar-metas";
import type { RegraPremio } from "./tipos-meta";
import { Input } from "@platform/ui/components/input";
import { MoneyInput } from "@platform/ui/components/money-input";
import type { TipoMetaComPremio } from "./tipo-meta-window";
import { useVisaoMetas, VisaoSelect } from "./metas-visualizacao";
import { TrendTooltip } from "@platform/ui/components/trend";

const BASE = "/api/m/inovafarma/metas";
const TODAS = "todas";
const JSON_HEADERS = { "Content-Type": "application/json" };

export interface PeriodoMetas {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "open" | "closed";
}

export interface LojaMetas {
  codigo: number;
  nome: string;
}

interface Colaborador {
  codigoColaborador: number;
  nome: string;
  ativo: boolean;
  /** Lojas confirmadas no Vínculo; sem nenhuma, só aparece em "Todas as Lojas". */
  lojas: number[];
}

export interface MetaVista extends Meta {
  tipo: TipoMetaComPremio;
  pendentes: number;
}

interface Montagem {
  somenteLeitura: boolean;
  copiadoDe: string | null;
  colaboradores: Colaborador[];
  metas: MetaVista[];
  tiposDisponiveis: { id: string; nome: string; indicador: IndicadorId }[];
}

/** Uma linha por Meta do Período; expande para os Participantes. */
const colunasMetas: DataTableColumn<MetaVista>[] = [
  {
    key: "meta",
    label: "Meta",
    value: (m) => m.tipo.nome,
    searchable: true,
    sortable: true,
    mobileRole: "primary",
  },
  {
    key: "indicador",
    label: "Indicador",
    value: (m) => indicadorPorId(m.tipo.indicador).nome,
    searchable: true,
  },
  { key: "premio", label: "Prêmio", value: (m) => m.tipo.premio, cellClassName: "min-w-64 whitespace-normal" },
  {
    key: "participantes",
    label: "Participantes",
    value: (m) => m.participantes.length,
    format: "number",
    sortable: true,
  },
  {
    key: "pendentes",
    centered: true,
    label: "Pendentes",
    value: (m) => m.pendentes,
    render: (m) =>
      m.pendentes ? <Badge variant="warning">{m.pendentes}</Badge> : null,
  },
];

const periodoInicial = (periodos: PeriodoMetas[]) =>
  (periodos.find((p) => p.status === "open") ?? periodos[0])?.id ?? "";

/** Adicionar Meta: escolhe um ou vários Tipos de Meta ativos de uma vez; cada um vira uma Meta do Período. */
function AdicionarMetaWindow({
  periodoId,
  tipos,
}: {
  periodoId: string;
  tipos: Montagem["tiposDisponiveis"];
}) {
  const { resolve } = useWindow<true>();
  const { feedback } = useUi();
  const [marcados, setMarcados] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const adicionar = async () => {
    if (marcados.length === 0)
      return feedback.notifyError(
        new Error("Escolha ao menos um Tipo de Meta."),
      );
    setEnviando(true);
    try {
      for (const tipoId of marcados)
        await apiFetch(BASE, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ periodoId, tipoId }),
        });
      feedback.notify({
        type: "success",
        title:
          marcados.length === 1
            ? "Meta adicionada."
            : `${marcados.length} Metas adicionadas.`,
      });
      resolve(true);
    } catch (err: unknown) {
      feedback.notifyError(
        err instanceof Error ? err : new Error("Erro ao adicionar a Meta."),
      );
      resolve(true);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <>
      <Stack gap="section">
        <Stack direction="row" gap="field" wrap>
          <Button
            type="button"
            variant="outline"
            onClick={() => setMarcados(tipos.map((t) => t.id))}
          >
            Selecionar todos
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setMarcados([])}
          >
            Desmarcar todos
          </Button>
        </Stack>
        <Stack gap="field">
          {tipos.map((t) => (
            <Stack key={t.id} direction="row" gap="field" align="center">
              <Switch
                checked={marcados.includes(t.id)}
                onCheckedChange={(on: boolean) =>
                  setMarcados((m) =>
                    on ? [...m, t.id] : m.filter((id) => id !== t.id),
                  )
                }
                aria-label={t.nome}
              />
              <Text variant="small">
                {t.nome} · {indicadorPorId(t.indicador).nome}
              </Text>
            </Stack>
          ))}
        </Stack>
      </Stack>
      <WindowActions>
        <WindowCancelButton />
        <Button
          type="button"
          disabled={enviando}
          onClick={() => void adicionar()}
        >
          Adicionar
        </Button>
      </WindowActions>
    </>
  );
}

/** Participação editada na tela e ainda não salva. */
interface Edicao {
  participa: boolean;
  alvo: number | null;
}
/** Edições por Meta e por Colaborador. */
type Edicoes = Record<string, Record<number, Edicao>>;

interface Alteracao {
  meta: MetaVista;
  codigoColaborador: number;
  nome: string;
  /** Participação editada; ausente numa alteração só do Prêmio. */
  edicao?: Edicao;
  /** Prêmio editado na célula: a regra própria, ou null para voltar ao Prêmio do Tipo de Meta. */
  premio?: RegraPremio | null;
  antes: string;
  depois: string;
}

/** Resumo das alterações antes de salvar; grava Meta a Meta, uma Participação por vez, seguindo a `version` devolvida. */
function SalvarAlteracoesWindow({ alteracoes }: { alteracoes: Alteracao[] }) {
  const { resolve } = useWindow<true>();
  const { feedback } = useUi();
  const [enviando, setEnviando] = useState(false);
  const salvar = async () => {
    setEnviando(true);
    const versoes = new Map<string, number>();
    try {
      for (const a of alteracoes) {
        const version = versoes.get(a.meta.id) ?? a.meta.version;
        if (!a.edicao) {
          const salva = await apiFetch<MetaVista>(`${BASE}/${a.meta.id}/participantes/${a.codigoColaborador}/premio`, {
            method: "PUT",
            headers: JSON_HEADERS,
            body: JSON.stringify({ version, premio: a.premio ?? null }),
          });
          versoes.set(a.meta.id, salva.version);
          continue;
        }
        const corpo = {
          version,
          participa: a.edicao.participa,
          ...(a.edicao.participa && a.edicao.alvo !== null
            ? { alvo: a.edicao.alvo }
            : {}),
        };
        const salva = await apiFetch<MetaVista>(
          `${BASE}/${a.meta.id}/participantes/${a.codigoColaborador}`,
          { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(corpo) },
        );
        versoes.set(a.meta.id, salva.version);
      }
      feedback.notify({
        type: "success",
        title:
          alteracoes.length === 1
            ? "Alteração salva."
            : `${alteracoes.length} alterações salvas.`,
      });
    } catch (err: unknown) {
      feedback.notifyError(
        err instanceof Error ? err : new Error("Erro ao salvar as alterações."),
      );
    } finally {
      setEnviando(false);
    }
    resolve(true);
  };
  const colunas: DataTableColumn<Alteracao>[] = [
    { key: "meta", label: "Meta", value: (a) => a.meta.tipo.nome },
    {
      key: "colaborador",
      label: "Colaborador",
      value: (a) => a.nome,
      mobileRole: "primary",
    },
    { key: "antes", label: "Antes", value: (a) => a.antes },
    { key: "depois", label: "Depois", value: (a) => a.depois },
  ];
  return (
    <>
      <DataTable
        scroll="page"
        columns={colunas}
        rows={alteracoes}
        getRowId={(a) => `${a.meta.id}-${a.codigoColaborador}`}
      />
      <WindowActions>
        <WindowCancelButton>Voltar</WindowCancelButton>
        <Button type="button" disabled={enviando} onClick={() => void salvar()}>
          Salvar
        </Button>
      </WindowActions>
    </>
  );
}

/** Uma Meta do Período: os Colaboradores com o checkbox de Participante e o Alvo de cada um. */
/** Ações de uma Meta na coluna Ações: Definir Alvo (ou valor inicial) e remover. */
function AcoesDaMeta({
  meta,
  somenteLeitura,
  periodoNome,
  recarregar,
}: {
  meta: MetaVista;
  somenteLeitura: boolean;
  periodoNome: string;
  recarregar: () => void;
}) {
  const { feedback, windows } = useUi();
  const avaliacoes = meta.tipo.indicador === "avaliacoes";
  const definirAlvo = async () => {
    const r = await windows.open<true>({
      surface: "sheet",
      title: avaliacoes ? "Definir valor inicial" : "Definir Alvo",
      description: `Meta "${meta.tipo.nome}" · ${periodoNome}`,
      content: () => (
        <DefinirAlvoWindow
          indicador={indicadorDoTipo(meta.tipo)}
          meta={{
            id: meta.periodoId,
            name: periodoNome,
            metaId: meta.id,
            version: meta.version,
            participantes: meta.participantes,
          }}
        />
      ),
    });
    if (r.status === "confirmed") recarregar();
  };

  const remover = async () => {
    const ok = await windows.confirm({
      title: "Remover Meta",
      description: `Remover a Meta "${meta.tipo.nome}" de ${periodoNome}, com os ${meta.participantes.length} Participantes e os Alvos deles?`,
      confirmLabel: "Remover",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`${BASE}/${meta.id}?version=${meta.version}`, {
        method: "DELETE",
      });
      feedback.notify({ type: "success", title: "Meta removida." });
    } catch (err: unknown) {
      feedback.notifyError(
        err instanceof Error ? err : new Error("Erro ao remover a Meta."),
      );
    }
    recarregar();
  };

  return (
    <Stack direction="row" gap="tight" justify="end">
      {!somenteLeitura && usaAlvo(meta.tipo) && (
        <Button variant="outline" onClick={() => void definirAlvo()}>
          <Target />
          {avaliacoes ? "Definir valor inicial" : "Definir Alvo"}
        </Button>
      )}
      {!somenteLeitura && (
        <Button
          size="icon"
          variant="ghost"
          tone="destructive"
          aria-label={`Remover a Meta ${meta.tipo.nome}`}
          onClick={() => void remover()}
        >
          <Trash2 />
        </Button>
      )}
    </Stack>
  );
}

/** O que a tela mostra de um Colaborador na Meta: a edição pendente ou o que está salvo. */
const participacao = (
  meta: MetaVista,
  edicoes: Record<number, Edicao> | undefined,
  codigo: number,
): Edicao => {
  const editada = edicoes?.[codigo];
  if (editada) return editada;
  const p = meta.participantes.find((x) => x.codigoColaborador === codigo);
  return p
    ? { participa: true, alvo: p.alvo }
    : { participa: false, alvo: null };
};

/** Uma Meta do Período: os Colaboradores com o Participa e o Alvo editáveis na própria linha. */
function MetaDoPeriodo({
  meta,
  colaboradores,
  somenteLeitura,
  edicoes,
  editar,
  atualizar,
}: {
  meta: MetaVista;
  colaboradores: Colaborador[];
  somenteLeitura: boolean;
  edicoes: Record<number, Edicao> | undefined;
  editar: (codigo: number, edicao: Edicao) => void;
  atualizar: (meta: MetaVista) => void;
}) {
  const { windows } = useUi();
  const temPremio = meta.tipo.regra.tipo !== "saldo";
  const alterarPremio = async (c: Colaborador) => {
    const participante = meta.participantes.find(
      (p) => p.codigoColaborador === c.codigoColaborador,
    );
    if (!participante) return;
    const r = await windows.open<MetaVista>({
      surface: "dialog",
      title: "Prêmio do Participante",
      description: `${c.nome} · Meta "${meta.tipo.nome}". Começa com o Prêmio do Tipo de Meta.`,
      content: () => (
        <PremioParticipanteWindow meta={meta} participante={participante} />
      ),
    });
    if (r.status === "confirmed") atualizar(r.value);
  };
  const indicador = indicadorDoTipo(meta.tipo);
  const avaliacoes = meta.tipo.indicador === "avaliacoes";
  const estado = (c: Colaborador) =>
    participacao(meta, edicoes, c.codigoColaborador);
  const salvo = (codigo: number) =>
    meta.participantes.some((p) => p.codigoColaborador === codigo);
  // Os Colaboradores inativos só aparecem enquanto participam.
  const linhas = colaboradores.filter(
    (c) => c.ativo || salvo(c.codigoColaborador),
  );
  const texto = (e: Edicao) =>
    !e.participa
      ? ""
      : e.alvo === null
        ? "Pendente"
        : formatarValor(indicador, e.alvo);

  const colunas: DataTableColumn<Colaborador>[] = [
    {
      key: "participa",
      label: "Participa",
      value: (c) => (estado(c).participa ? "Sim" : "Não"),
      render: (c) => (
        <Switch
          checked={estado(c).participa}
          disabled={somenteLeitura}
          onCheckedChange={(on: boolean) =>
            editar(c.codigoColaborador, { participa: on, alvo: estado(c).alvo })
          }
          aria-label={`${c.nome} participa da Meta ${meta.tipo.nome}`}
        />
      ),
    },
    {
      key: "nome",
      label: "Colaborador",
      value: (c) => c.nome,
      searchable: true,
      sortable: true,
      mobileRole: "primary",
    },
  ];
  if (usaAlvo(meta.tipo))
    colunas.push({
      key: "alvo",
      label: avaliacoes ? "Valor inicial" : "Alvo",
      value: (c) => texto(estado(c)),
      render: (c) => {
        const e = estado(c);
        if (!e.participa) return null;
        if (somenteLeitura)
          return e.alvo === null ? (
            <Badge variant="warning">Pendente</Badge>
          ) : (
            formatarValor(indicador, e.alvo)
          );
        return (
          <AlvoInput
            indicador={indicador}
            valor={e.alvo}
            onChange={(alvo) =>
              editar(c.codigoColaborador, { participa: true, alvo })
            }
            label={`${rotuloAlvo(indicador)} de ${c.nome}`}
          />
        );
      },
    });

  if (temPremio)
    colunas.push({
      key: "premio",
      label: "Prêmio",
      value: (c) => {
        const p = meta.participantes.find(
          (x) => x.codigoColaborador === c.codigoColaborador,
        );
        return p ? resumoPremio(regraDoParticipante(meta.tipo.regra, p)) : "";
      },
      render: (c) => {
        const p = meta.participantes.find(
          (x) => x.codigoColaborador === c.codigoColaborador,
        );
        if (!p) return null;
        const proprio = Boolean(
          p.premio && p.premio.tipo === meta.tipo.regra.tipo,
        );
        return (
          <Stack direction="row" gap="tight" align="center">
            {resumoPremio(regraDoParticipante(meta.tipo.regra, p))}
            {proprio && <Badge variant="secondary">Próprio</Badge>}
          </Stack>
        );
      },
    });

  return (
    <DataTable
      scroll="page"
      columns={colunas}
      rows={linhas}
      getRowId={(c) => String(c.codigoColaborador)}
      title="Participantes"
      emptyMessage="Nenhum Colaborador nesta Loja."
      search={{ placeholder: "Buscar Colaborador" }}
      rowActions={(c) =>
        !somenteLeitura && temPremio && salvo(c.codigoColaborador) ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Alterar o Prêmio de ${c.nome}`}
            onClick={() => void alterarPremio(c)}
          >
            <Pencil />
          </Button>
        ) : null
      }
    />
  );
}

/** A mesma Meta (Tipo de Meta) no Período anterior: Alvo e Realizado de cada Participante. */
interface ResultadoAnterior {
  codigoColaborador: number;
  alvo: number | null;
  realizado: number;
  atingimento: number | null;
  atingida: boolean | null;
}
interface Anterior {
  periodo: { id: string; name: string } | null;
  metas: { tipoId: string; participantes: ResultadoAnterior[] }[];
}

/** O valor do Prêmio editável na célula: o R$ (ou o % do Percentual do valor vendido). As Faixas em R$ só pelo lápis. */
const valorDoPremio = (r: RegraPremio): number | null =>
  r.tipo === "fixo" || r.tipo === "proporcional" || r.tipo === "faixasPercentuais" ? r.valorCentavos : r.tipo === "percentual" ? r.percentual : null;
const comValorDoPremio = (r: RegraPremio, v: number): RegraPremio =>
  r.tipo === "percentual" ? { ...r, percentual: v } : r.tipo === "fixo" || r.tipo === "proporcional" || r.tipo === "faixasPercentuais" ? { ...r, valorCentavos: v } : r;
/** A regra que o Participante tem hoje: a própria ou a do Tipo de Meta. */
const regraAtual = (meta: MetaVista, codigo: number): RegraPremio => {
  const p = meta.participantes.find((x) => x.codigoColaborador === codigo);
  return p ? regraDoParticipante(meta.tipo.regra, p) : meta.tipo.regra;
};
/** O Prêmio que a regra fica com o valor da célula: null quando volta a ser o do Tipo de Meta. */
const premioCom = (meta: MetaVista, codigo: number, v: number): RegraPremio | null => {
  const nova = comValorDoPremio(regraAtual(meta, codigo), v);
  return JSON.stringify(nova) === JSON.stringify(meta.tipo.regra) ? null : nova;
};

/** Campo do Prêmio na célula: R$ em centavos ou %. */
function PremioInput({ percentual, valor, onChange, label, disabled }: { percentual: boolean; valor: number; onChange: (v: number | null) => void; label: string; disabled: boolean }) {
  const [texto, setTexto] = useState(String(valor).replace(".", ","));
  useEffect(() => {
    setTexto((t) => (Number(t.replace(",", ".")) === valor ? t : String(valor).replace(".", ",")));
  }, [valor]);
  if (!percentual)
    return <MoneyInput value={valor / 100} disabled={disabled} onValueChange={(v) => onChange(v >= 0 ? Math.round(v * 100) : null)} aria-label={label} />;
  return (
    <Input
      inputMode="decimal"
      value={texto}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => {
        setTexto(e.target.value);
        const n = Number(e.target.value.trim().replace(",", "."));
        onChange(e.target.value.trim() && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null);
      }}
    />
  );
}

/** Participa e Alvo de um Colaborador numa Meta, editáveis na célula: digitar o Alvo já liga o Participa. */
function CelulaParticipacao({
  meta,
  colaborador,
  estado,
  editar,
  somenteLeitura,
}: {
  meta: MetaVista;
  colaborador: Colaborador;
  estado: Edicao;
  editar: (edicao: Edicao) => void;
  somenteLeitura: boolean;
}) {
  const indicador = indicadorDoTipo(meta.tipo);
  const comAlvo = usaAlvo(meta.tipo);
  const salvo = participacao(meta, undefined, colaborador.codigoColaborador);
  if (somenteLeitura)
    return !estado.participa ? (
      <Text variant="small" tone="muted">
        Não participa
      </Text>
    ) : !comAlvo ? (
      "Participa"
    ) : estado.alvo === null ? (
      <Badge variant="warning">Pendente</Badge>
    ) : (
      formatarValor(indicador, estado.alvo)
    );
  return (
    <Stack direction="row" gap="tight" align="center">
      <Switch
        checked={estado.participa}
        onCheckedChange={(on: boolean) => editar(on ? { participa: true, alvo: estado.alvo ?? salvo.alvo } : { participa: false, alvo: salvo.alvo })}
        aria-label={`${colaborador.nome} participa da Meta ${meta.tipo.nome}`}
      />
      {comAlvo && (
        <AlvoInput
          indicador={indicador}
          valor={estado.participa ? estado.alvo : null}
          onChange={(alvo) => editar({ participa: alvo !== null || estado.participa, alvo })}
          label={`${rotuloAlvo(indicador)} de ${colaborador.nome} na Meta ${meta.tipo.nome}`}
        />
      )}
    </Stack>
  );
}

/** Texto da participação para busca, ordenação e impressão. */
const textoParticipacao = (meta: MetaVista, e: Edicao) =>
  !e.participa ? "" : !usaAlvo(meta.tipo) ? "Participa" : e.alvo === null ? "Pendente" : formatarValor(indicadorDoTipo(meta.tipo), e.alvo);

interface VisaoProps {
  metas: MetaVista[];
  colaboradores: Colaborador[];
  somenteLeitura: boolean;
  estado: (meta: MetaVista, codigo: number) => Edicao;
  editar: (meta: MetaVista, codigo: number, edicao: Edicao) => void;
  loading: boolean;
}

/** Abre a janela do Prêmio do Participante (Faixas em R$, que não cabem numa célula) e atualiza a Meta gravada. */
function useAlterarPremio(atualizar: (meta: MetaVista) => void) {
  const { windows } = useUi();
  return useCallback(
    async (meta: MetaVista, c: Colaborador) => {
      const participante = meta.participantes.find((p) => p.codigoColaborador === c.codigoColaborador);
      if (!participante) return;
      const r = await windows.open<MetaVista>({
        surface: "dialog",
        title: "Prêmio do Participante",
        description: `${c.nome} · Meta "${meta.tipo.nome}". Começa com o Prêmio do Tipo de Meta.`,
        content: () => <PremioParticipanteWindow meta={meta} participante={participante} />,
      });
      if (r.status === "confirmed") atualizar(r.value);
    },
    [windows, atualizar],
  );
}

/** Edição do Prêmio na célula, comum à Tabela e ao Por Colaborador. */
interface EdicaoPremioProps {
  atualizar: (meta: MetaVista) => void;
  premio: (meta: MetaVista, codigo: number) => number | undefined;
  editarPremio: (meta: MetaVista, codigo: number, valor: number | null) => void;
}

/** Uma linha da Tabela: o Colaborador e a participação dele em cada Meta. Mantém a identidade enquanto nada muda nela. */
interface LinhaTabela {
  colaborador: Colaborador;
  estados: Record<string, Edicao>;
  /** Valor do Prêmio editado e ainda não salvo, por Meta. */
  premios: Record<string, number | undefined>;
}
const idDaLinha = (l: LinhaTabela) => String(l.colaborador.codigoColaborador);
const mesmaEdicao = (a: Edicao | undefined, b: Edicao) => a !== undefined && a.participa === b.participa && a.alvo === b.alvo;

/** Prêmio do Participante na própria célula: o valor editável (Faixas em R$ pelo lápis) e o selo do Prêmio próprio. */
function CelulaPremio({
  meta,
  colaborador,
  participa,
  pendente,
  somenteLeitura,
  editar,
  alterar,
}: {
  meta: MetaVista;
  colaborador: Colaborador;
  participa: boolean;
  /** Valor editado e ainda não salvo. */
  pendente: number | undefined;
  somenteLeitura: boolean;
  editar: (meta: MetaVista, codigo: number, valor: number | null) => void;
  alterar: (meta: MetaVista, c: Colaborador) => void;
}) {
  const p = meta.participantes.find((x) => x.codigoColaborador === colaborador.codigoColaborador);
  const regra = regraAtual(meta, colaborador.codigoColaborador);
  const proprio = Boolean(p?.premio && p.premio.tipo === meta.tipo.regra.tipo);
  const valor = valorDoPremio(regra);
  if (!participa) return null;
  if (somenteLeitura || valor === null)
    return (
      <Stack direction="row" gap="tight" align="center">
        <Text variant="small">{resumoPremio(regra)}</Text>
        {proprio && <Badge variant="secondary">Próprio</Badge>}
        {!somenteLeitura && p && (
          <Button size="icon" variant="ghost" aria-label={`Alterar o Prêmio de ${colaborador.nome} na Meta ${meta.tipo.nome}`} onClick={() => alterar(meta, colaborador)}>
            <Pencil />
          </Button>
        )}
      </Stack>
    );
  return (
    <Stack direction="row" gap="tight" align="center">
      <PremioInput
        percentual={regra.tipo === "percentual"}
        valor={pendente ?? valor}
        disabled={false}
        onChange={(v) => editar(meta, colaborador.codigoColaborador, v)}
        label={`Prêmio de ${colaborador.nome} na Meta ${meta.tipo.nome}`}
      />
      {(proprio || pendente !== undefined) && <Badge variant="secondary">Próprio</Badge>}
    </Stack>
  );
}

/**
 * Visualização Tabela: uma linha por Colaborador; cada Meta mostra a Meta anterior, o Atingido, a Nova meta e o Prêmio.
 * Setas navegam pelas Novas metas. Colunas e linhas são estáveis: digitar redesenha só a linha editada.
 */
function TabelaMontarMetas({
  metas,
  colaboradores,
  somenteLeitura,
  estado,
  editar,
  loading,
  anterior,
  atualizar,
  premio,
  editarPremio,
}: VisaoProps & {
  anterior: Anterior | null;
  atualizar: (meta: MetaVista) => void;
  premio: (meta: MetaVista, codigo: number) => number | undefined;
  editarPremio: (meta: MetaVista, codigo: number, valor: number | null) => void;
}) {
  const alterarPremio = useAlterarPremio(atualizar);

  // Reaproveita a linha anterior quando nenhuma participação dela mudou: o DataTable não a redesenha.
  const cache = useRef(new Map<number, LinhaTabela>());
  const linhas = colaboradores.map((c) => {
    const antiga = cache.current.get(c.codigoColaborador);
    const estados: Record<string, Edicao> = {};
    const premios: Record<string, number | undefined> = {};
    let igual = antiga !== undefined && antiga.colaborador === c;
    for (const m of metas) {
      premios[m.id] = premio(m, c.codigoColaborador);
      if (antiga?.premios[m.id] !== premios[m.id]) igual = false;
      const e = estado(m, c.codigoColaborador);
      if (igual && mesmaEdicao(antiga!.estados[m.id], e)) estados[m.id] = antiga!.estados[m.id]!;
      else {
        estados[m.id] = e;
        igual = false;
      }
    }
    if (igual && antiga && Object.keys(antiga.estados).length === metas.length) return antiga;
    const nova = { colaborador: c, estados, premios };
    cache.current.set(c.codigoColaborador, nova);
    return nova;
  });

  const colunas = useMemo(() => {
    const doAnterior = new Map((anterior?.metas ?? []).map((m) => [m.tipoId, new Map(m.participantes.map((p) => [p.codigoColaborador, p]))]));
    const cols: DataTableColumn<LinhaTabela>[] = [
      { key: "nome", label: "Colaborador", value: (l) => l.colaborador.nome, searchable: true, sortable: true, mobileRole: "primary", nowrap: true },
    ];
    for (const meta of metas) {
      const indicador = indicadorDoTipo(meta.tipo);
      const avaliacoes = meta.tipo.indicador === "avaliacoes";
      const antes = (l: LinhaTabela) => doAnterior.get(meta.tipoId)?.get(l.colaborador.codigoColaborador);
      // R$ chegam em centavos; o DataTable formata em reais.
      const formato = indicador.unidade === "reais" ? "currency" : indicador.unidade === "percentual" ? "percent" : "number";
      const emExibicao = (v: number) => (indicador.unidade === "reais" ? v / 100 : v);
      const temPremio = meta.tipo.regra.tipo !== "saldo";
      // Uma célula por Meta: em cima o Período anterior, embaixo o que se edita; rótulo, valor, rótulo, valor.
      cols.push({
        key: meta.id,
        label: meta.tipo.nome,
        centered: true,
        divider: true,
        value: (l) => textoParticipacao(meta, l.estados[meta.id]!),
        render: (l) => {
          const a = antes(l);
          const estadoMeta = l.estados[meta.id]!;
          const atingido = !a ? (
            "–"
          ) : (
            <Text variant="small" tone={a.atingida === true ? "success" : "default"}>
              {formatarValor(indicador, a.realizado)}
            </Text>
          );
          const anteriorLinha = [
            ...(usaAlvo(meta.tipo)
              ? [{ label: avaliacoes ? "Valor inicial anterior" : "Meta anterior", value: a?.alvo === null || a?.alvo === undefined ? "–" : formatarValor(indicador, a.alvo) }]
              : []),
            {
              label: avaliacoes ? "Saldo anterior" : "Atingido",
              // Como no Desempenho de Vendas: o tooltip compara o Atingido com a Meta anterior, em %.
              value:
                a && a.alvo !== null ? (
                  <TrendTooltip
                    trend={{ current: emExibicao(a.realizado), previous: emExibicao(a.alvo), label: "Meta anterior", format: formato, favorable: indicador.direcao === "menor" ? "down" : "up" }}
                  >
                    {atingido}
                  </TrendTooltip>
                ) : (
                  atingido
                ),
            },
          ];
          const atualLinha = [
            {
              label: !usaAlvo(meta.tipo) ? "Participa" : avaliacoes ? "Novo valor inicial" : "Nova meta",
              value: (
                <CelulaParticipacao
                  meta={meta}
                  colaborador={l.colaborador}
                  estado={estadoMeta}
                  editar={(e) => editar(meta, l.colaborador.codigoColaborador, e)}
                  somenteLeitura={somenteLeitura}
                />
              ),
            },
            ...(temPremio && estadoMeta.participa
              ? [
                  {
                    label: "Prêmio",
                    value: (
                      <CelulaPremio
                        meta={meta}
                        colaborador={l.colaborador}
                        participa
                        pendente={l.premios[meta.id]}
                        somenteLeitura={somenteLeitura}
                        editar={editarPremio}
                        alterar={(m, c) => void alterarPremio(m, c)}
                      />
                    ),
                  },
                ]
              : []),
          ];
          return <PairGrid pairs={2} rows={[anteriorLinha, atualLinha]} valueWidths={["13rem", "11rem"]} />;
        },
        cellClassName: "min-w-md",
      });
    }
    return cols;
  }, [metas, anterior, somenteLeitura, editar, alterarPremio, editarPremio]);

  return (
    <DataTable
      scroll="page"
      columns={colunas}
      rows={linhas}
      getRowId={idDaLinha}
      loading={loading}
      title="Metas do Período"
      description={
        anterior?.periodo
          ? `Meta anterior e Atingido: ${anterior.periodo.name}. Use as setas para navegar e digite a Nova meta; digitar já liga o Participa.`
          : "Use as setas para navegar e digite a Nova meta; digitar já liga o Participa."
      }
      emptyMessage={metas.length === 0 ? "Nenhuma Meta. Use Adicionar Meta para escolher os Tipos de Meta deste Período." : "Nenhum Colaborador nesta Loja."}
      search={{ placeholder: "Buscar Colaborador" }}
      frozenUntil="nome"
      arrowNavigation
      striped
    />
  );
}

/** Visualização Por Colaborador: uma linha por Colaborador; expande para as Metas dele, com Participa e Alvo. */
function PorColaboradorMontarMetas({ metas, colaboradores, somenteLeitura, estado, editar, loading, atualizar, premio, editarPremio }: VisaoProps & EdicaoPremioProps) {
  const alterarPremio = useAlterarPremio(atualizar);
  const colunas: DataTableColumn<Colaborador>[] = [
    { key: "nome", label: "Colaborador", value: (c) => c.nome, searchable: true, sortable: true, mobileRole: "primary" },
    {
      key: "metas",
      label: "Participa de",
      value: (c) => metas.filter((m) => estado(m, c.codigoColaborador).participa).length,
      format: "number",
      sortable: true,
    },
    {
      key: "pendentes",
      centered: true,
      label: "Pendentes",
      value: (c) => metas.filter((m) => usaAlvo(m.tipo) && estado(m, c.codigoColaborador).participa && estado(m, c.codigoColaborador).alvo === null).length,
      render: (c) => {
        const n = metas.filter((m) => usaAlvo(m.tipo) && estado(m, c.codigoColaborador).participa && estado(m, c.codigoColaborador).alvo === null).length;
        return n ? <Badge variant="warning">{n}</Badge> : null;
      },
    },
  ];
  return (
    <DataTable
      scroll="page"
      columns={colunas}
      rows={colaboradores}
      getRowId={(c) => String(c.codigoColaborador)}
      loading={loading}
      title="Colaboradores"
      emptyMessage="Nenhum Colaborador nesta Loja."
      search={{ placeholder: "Buscar Colaborador" }}
      renderExpanded={(c) => (
        <DataTable
          scroll="page"
          columns={[
            { key: "meta", label: "Meta", value: (m: MetaVista) => m.tipo.nome, sortable: true, mobileRole: "primary" },
            { key: "indicador", label: "Indicador", value: (m: MetaVista) => indicadorPorId(m.tipo.indicador).nome },
            {
              key: "participacao",
              label: "Participa · Alvo",
              value: (m: MetaVista) => textoParticipacao(m, estado(m, c.codigoColaborador)),
              render: (m: MetaVista) => (
                <CelulaParticipacao
                  meta={m}
                  colaborador={c}
                  estado={estado(m, c.codigoColaborador)}
                  editar={(e) => editar(m, c.codigoColaborador, e)}
                  somenteLeitura={somenteLeitura}
                />
              ),
            },
            {
              key: "premio",
              label: "Prêmio",
              value: (m: MetaVista) => (m.tipo.regra.tipo === "saldo" ? "" : resumoPremio(regraAtual(m, c.codigoColaborador))),
              render: (m: MetaVista) =>
                m.tipo.regra.tipo === "saldo" ? null : (
                  <CelulaPremio
                    meta={m}
                    colaborador={c}
                    participa={estado(m, c.codigoColaborador).participa}
                    pendente={premio(m, c.codigoColaborador)}
                    somenteLeitura={somenteLeitura}
                    editar={editarPremio}
                    alterar={(mm, cc) => void alterarPremio(mm, cc)}
                  />
                ),
              cellClassName: "min-w-44 whitespace-normal",
            },
          ]}
          rows={metas}
          getRowId={(m) => m.id}
          emptyMessage="Nenhuma Meta neste Período."
          arrowNavigation
        />
      )}
    />
  );
}

/** Aba Montar Metas: as Metas de cada Período, com Participantes, Alvos e Lista de Produtos. */
export function MontarMetas({
  periodos,
  lojas,
}: {
  periodos: PeriodoMetas[];
  lojas: LojaMetas[];
}) {
  const { feedback, windows } = useUi();
  const [periodoId, setPeriodoId] = useState(() => periodoInicial(periodos));
  const [loja, setLoja] = useState(TODAS);
  const [montagem, setMontagem] = useState<Montagem | null>(null);
  const { visao, salvar: salvarVisao, disponiveis } = useVisaoMetas("montar-metas", ["table", "by-meta", "by-colaborador"], "by-meta");
  const [anterior, setAnterior] = useState<Anterior | null>(null);
  const [edicoes, setEdicoes] = useState<Edicoes>({});
  /** Valor do Prêmio editado na Tabela, por Meta e por Colaborador. */
  const [premios, setPremios] = useState<Record<string, Record<number, number>>>({});
  const descartar = () => {
    setEdicoes({});
    setPremios({});
  };
  const consulta = useRef(0);
  const periodo = periodos.find((p) => p.id === periodoId);

  /** `manterEdicoes`: depois do Definir Alvo, as edições ainda não salvas da tela continuam. */
  const carregar = useCallback(async (manterEdicoes = false) => {
    if (!periodoId) return;
    const minha = ++consulta.current;
    try {
      const m = await apiFetch<Montagem>(
        `${BASE}?periodoId=${encodeURIComponent(periodoId)}`,
      );
      if (minha !== consulta.current) return;
      setMontagem(m);
      if (!manterEdicoes) {
        setEdicoes({});
        setPremios({});
      }
      if (m.copiadoDe)
        feedback.notify({
          type: "success",
          title: `Metas copiadas de ${m.copiadoDe}.`,
          description: "Confira os Participantes novos e os pendentes.",
        });
    } catch (err: unknown) {
      if (minha === consulta.current)
        feedback.notifyError(
          err instanceof Error ? err : new Error("Erro ao carregar as Metas."),
        );
    }
  }, [periodoId, feedback]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Só a Tabela mostra o Período anterior; ele apura no ERP, então vem à parte e não segura a montagem.
  useEffect(() => {
    if (!periodoId || visao !== "table") return;
    let vivo = true;
    setAnterior(null);
    apiFetch<Anterior>(`${BASE}/anterior?periodoId=${encodeURIComponent(periodoId)}`)
      .then((a) => vivo && setAnterior(a))
      .catch(() => vivo && setAnterior({ periodo: null, metas: [] }));
    return () => {
      vivo = false;
    };
  }, [periodoId, visao]);

  /** Definir Alvo (ou valor inicial) de uma Meta para vários Participantes, fora da visualização Por Meta. */
  const definirAlvo = async (meta: MetaVista) => {
    const avaliacoes = meta.tipo.indicador === "avaliacoes";
    const r = await windows.open<true>({
      surface: "sheet",
      title: avaliacoes ? "Definir valor inicial" : "Definir Alvo",
      description: `Meta "${meta.tipo.nome}" · ${periodo?.name ?? ""}`,
      content: () => (
        <DefinirAlvoWindow
          indicador={indicadorDoTipo(meta.tipo)}
          meta={{ id: meta.periodoId, name: periodo?.name ?? "", metaId: meta.id, version: meta.version, participantes: meta.participantes }}
        />
      ),
    });
    if (r.status === "confirmed") void carregar(true);
  };

  const adicionar = async () => {
    if (!montagem) return;
    const r = await windows.open<true>({
      surface: "sheet",
      title: "Adicionar Meta",
      description: `Escolha os Tipos de Meta de ${periodo?.name ?? "o Período"}. Todos os Colaboradores ativos entram como Participantes.`,
      content: () => (
        <AdicionarMetaWindow
          periodoId={periodoId}
          tipos={montagem.tiposDisponiveis}
        />
      ),
    });
    if (r.status === "confirmed") void carregar();
  };

  const atualizar = useCallback((meta: MetaVista) =>
    setMontagem(
      (m) =>
        m && { ...m, metas: m.metas.map((x) => (x.id === meta.id ? meta : x)) },
    ), []);

  /** Guarda a edição; voltar ao que está salvo desfaz a pendência. */
  const editar = useCallback((meta: MetaVista, codigo: number, edicao: Edicao) =>
    setEdicoes((atual) => {
      const daMeta = { ...(atual[meta.id] ?? {}) };
      const original = participacao(meta, undefined, codigo);
      if (
        original.participa === edicao.participa &&
        (!edicao.participa || original.alvo === edicao.alvo)
      )
        delete daMeta[codigo];
      else daMeta[codigo] = edicao;
      return { ...atual, [meta.id]: daMeta };
    }), []);

  /** Guarda o valor do Prêmio; voltar ao que está salvo desfaz a pendência. */
  const editarPremio = useCallback((meta: MetaVista, codigo: number, valor: number | null) =>
    setPremios((atual) => {
      const daMeta = { ...(atual[meta.id] ?? {}) };
      if (valor === null || valor === valorDoPremio(regraAtual(meta, codigo))) delete daMeta[codigo];
      else daMeta[codigo] = valor;
      return { ...atual, [meta.id]: daMeta };
    }), []);

  const nomeDe = (codigo: number) => montagem?.colaboradores.find((c) => c.codigoColaborador === codigo)?.nome ?? `Colaborador ${codigo}`;
  const alteracoesPremio: Alteracao[] = (montagem?.metas ?? []).flatMap((meta) =>
    Object.entries(premios[meta.id] ?? {}).map(([codigo, valor]) => {
      const premio = premioCom(meta, Number(codigo), valor);
      return {
        meta,
        codigoColaborador: Number(codigo),
        nome: nomeDe(Number(codigo)),
        premio,
        antes: `Prêmio ${resumoPremio(regraAtual(meta, Number(codigo)))}`,
        depois: `Prêmio ${resumoPremio(premio ?? meta.tipo.regra)}`,
      };
    }),
  );

  const alteracoesParticipacao: Alteracao[] = (montagem?.metas ?? []).flatMap((meta) =>
    Object.entries(edicoes[meta.id] ?? {}).map(([codigo, edicao]) => {
      const indicador = indicadorDoTipo(meta.tipo);
      const valor = (e: Edicao, novo: boolean) =>
        !e.participa
          ? "Não participa"
          : !usaAlvo(meta.tipo)
            ? "Participa"
            : e.alvo === null
              ? novo
                ? "Participa com o Alvo padrão"
                : "Participa · Alvo pendente"
              : `Participa · ${formatarValor(indicador, e.alvo)}`;
      const original = participacao(meta, undefined, Number(codigo));
      return {
        meta,
        codigoColaborador: Number(codigo),
        nome:
          montagem?.colaboradores.find(
            (c) => c.codigoColaborador === Number(codigo),
          )?.nome ?? `Colaborador ${codigo}`,
        edicao,
        antes: valor(original, false),
        depois: valor(edicao, !original.participa),
      };
    }),
  );

  // Participações primeiro: um Colaborador que entra agora já existe quando o Prêmio dele é gravado.
  const alteracoes = [...alteracoesParticipacao, ...alteracoesPremio];

  const salvarAlteracoes = async () => {
    const r = await windows.open<true>({
      surface: "dialog",
      size: "large",
      title: "Salvar alterações",
      description: `${alteracoes.length} alteraç${alteracoes.length === 1 ? "ão" : "ões"} nas Metas de ${periodo?.name ?? "o Período"}.`,
      content: () => <SalvarAlteracoesWindow alteracoes={alteracoes} />,
    });
    if (r.status === "confirmed") void carregar();
  };

  if (periodos.length === 0)
    return (
      <Alert>
        <AlertTitle>Nenhum Período de Fechamento</AlertTitle>
        <AlertDescription>
          Crie um Período de Fechamento para montar as Metas.
        </AlertDescription>
      </Alert>
    );

  const colaboradores = (montagem?.colaboradores ?? []).filter(
    (c) => loja === TODAS || c.lojas.includes(Number(loja)),
  );
  const metasDoPeriodo = montagem?.metas ?? [];
  const estadoDe = (meta: MetaVista, codigo: number) => participacao(meta, edicoes[meta.id], codigo);
  const premioDe = (meta: MetaVista, codigo: number): number | undefined => premios[meta.id]?.[codigo];
  // Nas visualizações por Colaborador, os inativos só aparecem enquanto participam de alguma Meta.
  const participantesSalvos = new Set(metasDoPeriodo.flatMap((m) => m.participantes.map((p) => p.codigoColaborador)));
  const linhasColaborador = colaboradores.filter((c) => c.ativo || participantesSalvos.has(c.codigoColaborador));
  const visaoProps: VisaoProps = {
    metas: metasDoPeriodo,
    colaboradores: linhasColaborador,
    somenteLeitura: montagem?.somenteLeitura ?? true,
    estado: estadoDe,
    editar,
    loading: !montagem,
  };
  return (
    <Stack gap="section">
      <HeaderActions>
        <Show on="lgUp">
          <Button
            variant="outline"
            disabled={alteracoes.length === 0}
            onClick={descartar}
          >
            Descartar
          </Button>
          <Button
            variant="outline"
            disabled={alteracoes.length === 0}
            onClick={() => void salvarAlteracoes()}
          >
            <Save />
            Salvar alterações{alteracoes.length ? ` (${alteracoes.length})` : ""}
          </Button>
          <Button
            disabled={
              !montagem ||
              montagem.somenteLeitura ||
              !montagem.tiposDisponiveis?.length
            }
            onClick={() => void adicionar()}
          >
            <Plus />
            Adicionar Meta
          </Button>
        </Show>
        <Show on="belowLg">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Mais ações" />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={alteracoes.length === 0} onClick={descartar}>
                Descartar
              </DropdownMenuItem>
              <DropdownMenuItem disabled={alteracoes.length === 0} onClick={() => void salvarAlteracoes()}>
                <Save />
                Salvar alterações{alteracoes.length ? ` (${alteracoes.length})` : ""}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!montagem || montagem.somenteLeitura || !montagem.tiposDisponiveis?.length} onClick={() => void adicionar()}>
                <Plus />
                Adicionar Meta
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Show>
      </HeaderActions>
      <Stack direction="row" align="end" gap="section" wrap>
        <VisaoSelect visao={visao} disponiveis={disponiveis} onChange={salvarVisao} />
        {visao !== "by-meta" && montagem && !montagem.somenteLeitura && montagem.metas.some((m) => usaAlvo(m.tipo)) && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              <Target />
              Definir Alvo
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {montagem.metas
                .filter((m) => usaAlvo(m.tipo))
                .map((m) => (
                  <DropdownMenuItem key={m.id} onClick={() => void definirAlvo(m)}>
                    {m.tipo.nome}
                    {m.tipo.indicador === "avaliacoes" ? " · valor inicial" : ""}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Stack gap="field">
          <Label>Período de Fechamento</Label>
          <Select value={periodoId} onValueChange={(v) => v && setPeriodoId(v)}>
            <SelectTrigger aria-label="Período de Fechamento">
              <SelectValue>
                {(id: string) =>
                  periodos.find((p) => p.id === id)?.name ?? "Selecione"
                }
              </SelectValue>
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
        <Stack gap="field">
          <Label>Loja</Label>
          <Select value={loja} onValueChange={(v) => v && setLoja(v)}>
            <SelectTrigger aria-label="Loja">
              <SelectValue>
                {(v: string) =>
                  v === TODAS
                    ? "Todas as Lojas"
                    : lojas.find((l) => String(l.codigo) === v)?.nome ||
                      `Loja ${v}`
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>Todas as Lojas</SelectItem>
              {lojas.map((l) => (
                <SelectItem key={l.codigo} value={String(l.codigo)}>
                  {l.nome || `Loja ${l.codigo}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Stack>
      </Stack>
      {montagem?.somenteLeitura && (
        <Alert>
          <AlertTitle>Período fechado</AlertTitle>
          <AlertDescription>
            As Metas de um Período fechado ficam só para leitura.
          </AlertDescription>
        </Alert>
      )}
      {visao === "table" && <TabelaMontarMetas {...visaoProps} anterior={anterior} atualizar={atualizar} premio={premioDe} editarPremio={editarPremio} />}
      {visao === "by-colaborador" && <PorColaboradorMontarMetas {...visaoProps} atualizar={atualizar} premio={premioDe} editarPremio={editarPremio} />}
      {visao === "by-meta" && <DataTable
        scroll="page"
        columns={colunasMetas}
        rows={montagem?.metas ?? []}
        getRowId={(m) => m.id}
        loading={!montagem}
        title="Metas do Período"
        emptyMessage={
          montagem?.somenteLeitura
            ? "Este Período fechou sem Metas."
            : "Nenhuma Meta. Use Adicionar Meta para escolher os Tipos de Meta deste Período."
        }
        search={{ placeholder: "Buscar Meta" }}
        rowActions={(m) =>
          montagem && (
            <AcoesDaMeta
              meta={m}
              somenteLeitura={montagem.somenteLeitura}
              periodoNome={periodo?.name ?? ""}
              recarregar={() => void carregar()}
            />
          )
        }
        renderExpanded={(m) =>
          montagem && (
            <MetaDoPeriodo
              meta={m}
              colaboradores={colaboradores}
              somenteLeitura={montagem.somenteLeitura}
              edicoes={edicoes[m.id]}
              editar={(codigo, edicao) => editar(m, codigo, edicao)}
              atualizar={atualizar}
            />
          )
        }
      />}
    </Stack>
  );
}
