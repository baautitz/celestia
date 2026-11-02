import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ListChecks, Pencil, Plus, Target } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@platform/ui/components/collapsible";
import { Label } from "@platform/ui/components/label";
import { Stack, Text } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Switch } from "@platform/ui/components/switch";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { HeaderActions } from "@platform/ui/context/header-actions";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { AlvoInput, rotuloAlvo } from "./alvo-input";
import { DefinirAlvoWindow } from "./alvo-padrao-window";
import { formatarValor, indicadorPorId, type IndicadorId } from "./indicadores";
import { ListaProdutosWindow } from "./lista-produtos-window";
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

const usaAlvo = (t: TipoMetaComPremio) => !t.semAlvo && t.indicador !== "lista-produtos";
const periodoInicial = (periodos: PeriodoMetas[]) => (periodos.find((p) => p.status === "open") ?? periodos[0])?.id ?? "";

/** Adicionar Meta: escolhe um ou vários Tipos de Meta ativos de uma vez; cada um vira uma Meta do Período. */
function AdicionarMetaWindow({ periodoId, tipos }: { periodoId: string; tipos: Montagem["tiposDisponiveis"] }) {
  const { resolve } = useWindow<true>();
  const { feedback } = useUi();
  const [marcados, setMarcados] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const adicionar = async () => {
    if (marcados.length === 0) return feedback.notifyError(new Error("Escolha ao menos um Tipo de Meta."));
    setEnviando(true);
    try {
      for (const tipoId of marcados) await apiFetch(BASE, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ periodoId, tipoId }) });
      feedback.notify({ type: "success", title: marcados.length === 1 ? "Meta adicionada." : `${marcados.length} Metas adicionadas.` });
      resolve(true);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao adicionar a Meta."));
      resolve(true);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <>
      <Stack gap="section">
        <Stack direction="row" gap="field" wrap>
          <Button type="button" variant="outline" onClick={() => setMarcados(tipos.map((t) => t.id))}>
            Selecionar todos
          </Button>
          <Button type="button" variant="outline" onClick={() => setMarcados([])}>
            Desmarcar todos
          </Button>
        </Stack>
        <Stack gap="field">
          {tipos.map((t) => (
            <Stack key={t.id} direction="row" gap="field" align="center">
              <Switch
                checked={marcados.includes(t.id)}
                onCheckedChange={(on: boolean) => setMarcados((m) => (on ? [...m, t.id] : m.filter((id) => id !== t.id)))}
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
        <Button type="button" disabled={enviando} onClick={() => void adicionar()}>
          Adicionar
        </Button>
      </WindowActions>
    </>
  );
}

function AlvoParticipanteWindow({ meta, codigoColaborador }: { meta: MetaVista; codigoColaborador: number }) {
  const { resolve } = useWindow<MetaVista>();
  const { feedback } = useUi();
  const participante = meta.participantes.find((p) => p.codigoColaborador === codigoColaborador)!;
  const [alvo, setAlvo] = useState(participante.alvo);
  const [enviando, setEnviando] = useState(false);
  const indicador = indicadorPorId(meta.tipo.indicador);
  const salvar = async () => {
    setEnviando(true);
    try {
      resolve(
        await apiFetch<MetaVista>(`${BASE}/${meta.id}/participantes/${codigoColaborador}`, {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({ version: meta.version, participa: true, alvo }),
        }),
      );
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao alterar o Alvo."));
    } finally {
      setEnviando(false);
    }
  };
  return (
    <>
      <Stack gap="field">
        <Label>{rotuloAlvo(indicador)}</Label>
        <AlvoInput autoFocus indicador={indicador} valor={alvo} onChange={setAlvo} label={rotuloAlvo(indicador)} />
      </Stack>
      <WindowActions>
        <WindowCancelButton />
        <Button type="button" disabled={enviando} onClick={() => void salvar()}>
          Salvar
        </Button>
      </WindowActions>
    </>
  );
}

/** Uma Meta do Período: os Colaboradores com o checkbox de Participante e o Alvo de cada um. */
function MetaDoPeriodo({
  meta,
  colaboradores,
  somenteLeitura,
  periodoNome,
  atualizar,
  recarregar,
}: {
  meta: MetaVista;
  colaboradores: Colaborador[];
  somenteLeitura: boolean;
  periodoNome: string;
  atualizar: (meta: MetaVista) => void;
  recarregar: () => void;
}) {
  const { feedback, windows } = useUi();
  const indicador = indicadorPorId(meta.tipo.indicador);
  const avaliacoes = meta.tipo.indicador === "avaliacoes";
  const participante = (codigo: number) => meta.participantes.find((p) => p.codigoColaborador === codigo);
  // Os Colaboradores inativos só aparecem enquanto participam.
  const linhas = colaboradores.filter((c) => c.ativo || participante(c.codigoColaborador));

  const marcar = async (c: Colaborador, participa: boolean) => {
    try {
      atualizar(
        await apiFetch<MetaVista>(`${BASE}/${meta.id}/participantes/${c.codigoColaborador}`, {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({ version: meta.version, participa }),
        }),
      );
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao alterar o Participante."));
      recarregar();
    }
  };

  const alterarAlvo = async (c: Colaborador) => {
    const r = await windows.open<MetaVista>({
      surface: "dialog",
      title: avaliacoes ? "Alterar valor inicial" : "Alterar Alvo",
      description: `${c.nome} · Meta "${meta.tipo.nome}"`,
      content: () => <AlvoParticipanteWindow meta={meta} codigoColaborador={c.codigoColaborador} />,
    });
    if (r.status === "confirmed") atualizar(r.value);
  };

  const definirAlvo = async () => {
    const r = await windows.open<true>({
      surface: "sheet",
      title: avaliacoes ? "Definir valor inicial" : "Definir Alvo",
      description: `Meta "${meta.tipo.nome}" · ${periodoNome}`,
      content: () => <DefinirAlvoWindow indicadorId={meta.tipo.indicador} meta={{ id: meta.periodoId, name: periodoNome, metaId: meta.id, version: meta.version, participantes: meta.participantes }} />,
    });
    if (r.status === "confirmed") recarregar();
  };

  const abrirLista = async () => {
    const r = await windows.open<Meta>({
      surface: "sheet",
      title: "Lista de Produtos",
      description: `Meta "${meta.tipo.nome}" · ${periodoNome}`,
      content: () => <ListaProdutosWindow meta={meta} somenteLeitura={somenteLeitura} />,
    });
    if (r.status === "confirmed") recarregar();
  };

  const colunas: DataTableColumn<Colaborador>[] = [
    {
      key: "participa",
      label: "Participa",
      value: (c) => (participante(c.codigoColaborador) ? "Sim" : "Não"),
      render: (c) => (
        <Switch
          checked={Boolean(participante(c.codigoColaborador))}
          disabled={somenteLeitura}
          onCheckedChange={(on: boolean) => void marcar(c, on)}
          aria-label={`${c.nome} participa da Meta ${meta.tipo.nome}`}
        />
      ),
    },
    { key: "nome", label: "Colaborador", value: (c) => c.nome, searchable: true, sortable: true, mobileRole: "primary" },
  ];
  if (usaAlvo(meta.tipo))
    colunas.push({
      key: "alvo",
      label: avaliacoes ? "Valor inicial" : "Alvo",
      value: (c) => {
        const p = participante(c.codigoColaborador);
        return !p ? "" : p.alvo === null ? "Pendente" : formatarValor(indicador, p.alvo);
      },
      render: (c) => {
        const p = participante(c.codigoColaborador);
        if (!p) return null;
        return p.alvo === null ? <Badge variant="warning">Pendente</Badge> : formatarValor(indicador, p.alvo);
      },
    });

  const descricao = [meta.tipo.premio, meta.pendentes ? `${meta.pendentes} pendente${meta.pendentes === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  const resumo = [indicador.nome, descricao, `${meta.participantes.length} Participante${meta.participantes.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
  return (
    <Collapsible>
      <Stack direction="row" gap="field" align="center" wrap>
        <CollapsibleTrigger render={<Button variant="ghost" />}>
          <ChevronDown />
          {meta.tipo.nome}
        </CollapsibleTrigger>
        <Text variant="small" tone="muted">
          {resumo}
        </Text>
      </Stack>
      <CollapsibleContent>
    <Stack gap="field">
      {!somenteLeitura && (
        <Stack direction="row" gap="field" justify="end" wrap>
          {usaAlvo(meta.tipo) && (
            <Button variant="outline" onClick={() => void definirAlvo()}>
              <Target />
              {avaliacoes ? "Definir valor inicial" : "Definir Alvo"}
            </Button>
          )}
          {meta.tipo.indicador === "lista-produtos" && (
            <Button variant="outline" onClick={() => void abrirLista()}>
              <ListChecks />
              Lista de Produtos
            </Button>
          )}
        </Stack>
      )}
      {somenteLeitura && meta.tipo.indicador === "lista-produtos" && (
        <Stack direction="row" justify="end">
          <Button variant="outline" onClick={() => void abrirLista()}>
            <ListChecks />
            Lista de Produtos
          </Button>
        </Stack>
      )}
      <DataTable
        columns={colunas}
        rows={linhas}
        getRowId={(c) => String(c.codigoColaborador)}
        title="Participantes"
        emptyMessage="Nenhum Colaborador nesta Loja."
        search={{ placeholder: "Buscar Colaborador" }}
        rowActions={(c) =>
          !somenteLeitura && usaAlvo(meta.tipo) && participante(c.codigoColaborador) ? (
            <Button size="icon" variant="ghost" aria-label={`${avaliacoes ? "Alterar valor inicial" : "Alterar Alvo"} de ${c.nome}`} onClick={() => void alterarAlvo(c)}>
              <Pencil />
            </Button>
          ) : null
        }
      />
    </Stack>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Aba Montar Metas: as Metas de cada Período, com Participantes, Alvos e Lista de Produtos. */
export function MontarMetas({ periodos, lojas }: { periodos: PeriodoMetas[]; lojas: LojaMetas[] }) {
  const { feedback, windows } = useUi();
  const [periodoId, setPeriodoId] = useState(() => periodoInicial(periodos));
  const [loja, setLoja] = useState(TODAS);
  const [montagem, setMontagem] = useState<Montagem | null>(null);
  const consulta = useRef(0);
  const periodo = periodos.find((p) => p.id === periodoId);

  const carregar = useCallback(async () => {
    if (!periodoId) return;
    const minha = ++consulta.current;
    try {
      const m = await apiFetch<Montagem>(`${BASE}?periodoId=${encodeURIComponent(periodoId)}`);
      if (minha !== consulta.current) return;
      setMontagem(m);
      if (m.copiadoDe) feedback.notify({ type: "success", title: `Metas copiadas de ${m.copiadoDe}.`, description: "Confira os Participantes novos e os pendentes." });
    } catch (err: unknown) {
      if (minha === consulta.current) feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar as Metas."));
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
      content: () => <AdicionarMetaWindow periodoId={periodoId} tipos={montagem.tiposDisponiveis} />,
    });
    if (r.status === "confirmed") void carregar();
  };

  const atualizar = (meta: MetaVista) => setMontagem((m) => m && { ...m, metas: m.metas.map((x) => (x.id === meta.id ? meta : x)) });



  if (periodos.length === 0)
    return (
      <Alert>
        <AlertTitle>Nenhum Período de Fechamento</AlertTitle>
        <AlertDescription>Crie um Período de Fechamento para montar as Metas.</AlertDescription>
      </Alert>
    );

  const colaboradores = (montagem?.colaboradores ?? []).filter((c) => loja === TODAS || c.lojas.includes(Number(loja)));
  return (
    <Stack gap="section">
      <HeaderActions>
        <Button disabled={!montagem || montagem.somenteLeitura || !montagem.tiposDisponiveis?.length} onClick={() => void adicionar()}>
          <Plus />
          Adicionar Meta
        </Button>
      </HeaderActions>
      <Stack direction="row" align="end" gap="section" wrap>
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
        <Stack gap="field">
          <Label>Loja</Label>
          <Select value={loja} onValueChange={(v) => v && setLoja(v)}>
            <SelectTrigger aria-label="Loja">
              <SelectValue>{(v: string) => (v === TODAS ? "Todas as Lojas" : lojas.find((l) => String(l.codigo) === v)?.nome || `Loja ${v}`)}</SelectValue>
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
          <AlertDescription>As Metas de um Período fechado ficam só para leitura.</AlertDescription>
        </Alert>
      )}
      {montagem && montagem.metas.length === 0 && (
        <Alert>
          <AlertTitle>Nenhuma Meta neste Período</AlertTitle>
          <AlertDescription>
            {montagem.somenteLeitura ? "Este Período fechou sem Metas." : "Use Adicionar Meta para escolher os Tipos de Meta deste Período."}
          </AlertDescription>
        </Alert>
      )}
      {montagem?.metas.map((m) => (
        <MetaDoPeriodo
          key={m.id}
          meta={m}
          colaboradores={colaboradores}
          somenteLeitura={montagem.somenteLeitura}
          periodoNome={periodo?.name ?? ""}
          atualizar={atualizar}
          recarregar={() => void carregar()}
        />
      ))}
    </Stack>
  );
}
