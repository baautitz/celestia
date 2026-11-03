import { useCallback, useEffect, useRef, useState } from "react";
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
import { Show, Stack, Text } from "@platform/ui/components/layout";
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
import { regraDoParticipante } from "./apuracao";
import {
  PremioParticipanteWindow,
  resumoPremio,
} from "./premio-participante-window";
import type { Meta } from "./metas-store";
import type { TipoMetaComPremio } from "./tipo-meta-window";

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
  { key: "premio", label: "Prêmio", value: (m) => m.tipo.premio },
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

const usaAlvo = (t: TipoMetaComPremio) => !t.semAlvo;
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
  edicao: Edicao;
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
          indicadorId={meta.tipo.indicador}
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
  const indicador = indicadorPorId(meta.tipo.indicador);
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
  const [edicoes, setEdicoes] = useState<Edicoes>({});
  const consulta = useRef(0);
  const periodo = periodos.find((p) => p.id === periodoId);

  const carregar = useCallback(async () => {
    if (!periodoId) return;
    const minha = ++consulta.current;
    try {
      const m = await apiFetch<Montagem>(
        `${BASE}?periodoId=${encodeURIComponent(periodoId)}`,
      );
      if (minha !== consulta.current) return;
      setMontagem(m);
      setEdicoes({});
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

  const atualizar = (meta: MetaVista) =>
    setMontagem(
      (m) =>
        m && { ...m, metas: m.metas.map((x) => (x.id === meta.id ? meta : x)) },
    );

  /** Guarda a edição; voltar ao que está salvo desfaz a pendência. */
  const editar = (meta: MetaVista, codigo: number, edicao: Edicao) =>
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
    });

  const alteracoes: Alteracao[] = (montagem?.metas ?? []).flatMap((meta) =>
    Object.entries(edicoes[meta.id] ?? {}).map(([codigo, edicao]) => {
      const indicador = indicadorPorId(meta.tipo.indicador);
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
  return (
    <Stack gap="section">
      <HeaderActions>
        <Show on="lgUp">
          <Button
            variant="outline"
            disabled={alteracoes.length === 0}
            onClick={() => setEdicoes({})}
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
              <DropdownMenuItem disabled={alteracoes.length === 0} onClick={() => setEdicoes({})}>
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
      <DataTable
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
      />
    </Stack>
  );
}
