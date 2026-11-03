import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuditLogEntry, AuditLogFacets, AuditLogFilter } from "@platform/shared";
import { Button } from "@platform/ui/components/button";
import { Show, Spin, Stack, Text } from "@platform/ui/components/layout";
import { Badge } from "@platform/ui/components/badge";
import { Input } from "@platform/ui/components/input";
import { Label } from "@platform/ui/components/label";
import { DateRangePicker } from "@platform/ui/components/date-range-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@platform/ui/components/combobox";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { useWindow, WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";
import { formatDate } from "@platform/ui/lib/format";
import { toLocalISODate } from "@platform/ui/lib/utils";
import { FilterX, RefreshCw, SlidersHorizontal } from "lucide-react";
import { api } from "@/lib/api-client";
import { HeaderActions } from "@/context/HeaderActionsContext";

type Actor = AuditLogFacets["actors"][number];

/** Filtros da tela. O período nunca fica vazio, para a consulta não trazer o histórico inteiro. */
interface Filters {
  period: { from: Date; to: Date };
  actor: Actor | null;
  plugin: string;
  targetType: string;
  targetId: string;
}

const ALL_PLUGINS = "todos";
/** Espera após a digitação antes de consultar pelo alvo. */
const TYPING_DELAY_MS = 400;
const EMPTY_FACETS: AuditLogFacets = { actors: [], plugins: [] };

const formatDateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR");
/** A tela abre nos últimos 7 dias. */
const defaultPeriod = (): Filters["period"] => {
  const to = new Date();
  const from = new Date(to);
  from.setDate(to.getDate() - 6);
  return { from, to };
};
const defaultFilters = (): Filters => ({ period: defaultPeriod(), actor: null, plugin: ALL_PLUGINS, targetType: "", targetId: "" });

const toQuery = (f: Filters): AuditLogFilter => ({
  from: toLocalISODate(f.period.from),
  to: toLocalISODate(f.period.to),
  actorId: f.actor?.id,
  plugin: f.plugin === ALL_PLUGINS ? undefined : f.plugin,
  targetType: f.targetType.trim() || undefined,
  targetId: f.targetId.trim() || undefined,
});

const describePeriod = (p: Filters["period"]) => `${formatDate(p.from)} a ${formatDate(p.to)}`;

/** Filtros além do período, em texto (resumo no celular e descrição da impressão). */
const describeOthers = (f: Filters) =>
  [
    f.actor ? `Usuário: ${f.actor.name}` : null,
    f.plugin !== ALL_PLUGINS ? `Plugin: ${f.plugin}` : null,
    f.targetType.trim() ? `Tipo do alvo: ${f.targetType.trim()}` : null,
    f.targetId.trim() ? `Id do alvo: ${f.targetId.trim()}` : null,
  ].filter((s): s is string => s !== null);

const columns: DataTableColumn<AuditLogEntry>[] = [
  {
    key: "occurredAt",
    centered: true,
    label: "Quando",
    value: (e) => formatDateTime(e.occurredAt),
    cellClassName: "text-xs text-muted-foreground",
    skeletonClassName: "h-4 w-32",
  },
  {
    key: "actor",
    searchable: true,
    label: "Quem",
    value: (e) => e.actorName,
    mobileRole: "primary",
    cellClassName: "font-medium",
    skeletonClassName: "h-4 w-28",
  },
  {
    key: "device",
    searchable: true,
    label: "Dispositivo",
    value: (e) => e.deviceName ?? "",
    render: (e) => e.deviceName ?? "—",
    skeletonClassName: "h-4 w-24",
  },
  {
    key: "plugin",
    searchable: true,
    centered: true,
    label: "Plugin",
    value: (e) => e.plugin,
    render: (e) => <Badge variant="secondary">{e.plugin}</Badge>,
    skeletonClassName: "h-5 w-16",
  },
  {
    key: "summary",
    searchable: true,
    label: "Resumo",
    value: (e) => e.summary,
    // Duas linhas: o resumo legível (quebra numa largura de leitura) e, abaixo, o código da ação.
    render: (e) => (
      <Stack gap="none">
        <Text variant="small">{e.summary}</Text>
        <Text variant="mono" tone="muted">{e.action}</Text>
      </Stack>
    ),
    mobileWide: true,
    cellClassName: "whitespace-normal min-w-64 max-w-md",
    skeletonClassName: "h-8 w-48",
  },
  {
    key: "target",
    searchable: true,
    label: "Alvo",
    value: (e) => `${e.targetType} ${e.targetId}`,
    // Ids longos (UUID) quebram abaixo do tipo, em vez de alargar a tabela.
    render: (e) => (
      <Stack gap="none">
        <Text variant="small">{e.targetType}</Text>
        <Text variant="mono" tone="muted" breakAll>{e.targetId}</Text>
      </Stack>
    ),
    mobileWide: true,
    cellClassName: "whitespace-normal min-w-40 max-w-56",
    skeletonClassName: "h-8 w-32",
  },
];

/**
 * Campos dos filtros, usados na barra (desktop) e no drawer (celular).
 * `idPrefix` separa os ids dos dois lugares, que podem estar no DOM ao mesmo tempo.
 */
const FilterFields: React.FC<{
  idPrefix: string;
  value: Filters;
  onChange: (next: Filters) => void;
  facets: AuditLogFacets;
  showTarget: boolean;
}> = ({ idPrefix, value, onChange, facets, showTarget }) => {
  const [actorSearch, setActorSearch] = useState(value.actor?.name ?? "");
  const id = (field: string) => `${idPrefix}-${field}`;
  return (
    <>
      <Stack gap="field" grow narrow>
        <Label>Período</Label>
        <DateRangePicker
          value={value.period}
          onChange={(range) => onChange({ ...value, period: range?.from && range.to ? { from: range.from, to: range.to } : defaultPeriod() })}
        />
      </Stack>
      <Stack gap="field" grow narrow>
        <Label htmlFor={id("actor")}>Usuário</Label>
        <Combobox
          items={facets.actors}
          value={value.actor}
          inputValue={actorSearch}
          onInputValueChange={setActorSearch}
          onValueChange={(a: Actor | null) => {
            setActorSearch(a?.name ?? "");
            onChange({ ...value, actor: a });
          }}
          itemToStringLabel={(a: Actor) => a.name}
          itemToStringValue={(a: Actor) => a.id}
          isItemEqualToValue={(a: Actor, b: Actor) => a.id === b.id}
        >
          <ComboboxInput id={id("actor")} placeholder="Todos" showClear clearLabel="Limpar usuário" />
          <ComboboxContent>
            <ComboboxEmpty>Nenhum usuário encontrado.</ComboboxEmpty>
            <ComboboxList>
              {(a: Actor) => (
                <ComboboxItem key={a.id} value={a}>
                  {a.name}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Stack>
      <Stack gap="field" grow narrow>
        <Label htmlFor={id("plugin")}>Plugin</Label>
        <Select value={value.plugin} onValueChange={(val) => val && onChange({ ...value, plugin: val })}>
          <SelectTrigger id={id("plugin")}>
            <SelectValue>{(val: string) => (val === ALL_PLUGINS ? "Todos" : val)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PLUGINS}>Todos</SelectItem>
            {facets.plugins.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Stack>
      {showTarget && (
        <>
          <Stack gap="field" grow narrow>
            <Label htmlFor={id("targetType")}>Tipo do alvo</Label>
            <Input id={id("targetType")} value={value.targetType} onChange={(e) => onChange({ ...value, targetType: e.target.value })} />
          </Stack>
          <Stack gap="field" grow narrow>
            <Label htmlFor={id("targetId")}>Id do alvo</Label>
            <Input id={id("targetId")} value={value.targetId} onChange={(e) => onChange({ ...value, targetId: e.target.value })} />
          </Stack>
        </>
      )}
    </>
  );
};

/** Filtros no celular: o rascunho só vale ao tocar em "Aplicar". */
const FiltersDrawer: React.FC<{ initial: Filters; facets: AuditLogFacets }> = ({ initial, facets }) => {
  const { resolve } = useWindow<Filters>();
  const [draft, setDraft] = useState(initial);
  return (
    <Stack gap="section">
      <FilterFields idPrefix="audit-drawer" value={draft} onChange={setDraft} facets={facets} showTarget />
      <WindowActions>
        <WindowCancelButton />
        <Button variant="outline" onClick={() => resolve(defaultFilters())}>Limpar</Button>
        <Button onClick={() => resolve(draft)}>Aplicar</Button>
      </WindowActions>
    </Stack>
  );
};

const DetailRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Stack gap="tight">
    <Text variant="caption" tone="muted">{label}</Text>
    {children}
  </Stack>
);

const attributeText = (value: unknown) => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));

/** Detalhe de uma entrada, aberto na própria lista: o que as colunas não mostram. */
const AuditEntryDetails: React.FC<{ entry: AuditLogEntry }> = ({ entry }) => {
  const attributes = Object.entries(entry.attributes);
  return (
    <Stack gap="section" padding="card">
      <DetailRow label="Id do usuário">
        <Text variant="mono" tone="muted" breakAll>{entry.actorId}</Text>
      </DetailRow>
      <DetailRow label="Atributos">
        {attributes.length === 0 ? (
          <Text tone="muted">Nenhum atributo.</Text>
        ) : (
          <Stack surface="muted" gap="field" divided>
            {attributes.map(([key, value]) => (
              <Stack key={key} gap="tight">
                <Text variant="mono" tone="muted">{key}</Text>
                <Text variant="mono" breakAll>{attributeText(value)}</Text>
              </Stack>
            ))}
          </Stack>
        )}
      </DetailRow>
    </Stack>
  );
};

export const AuditLogPage: React.FC = () => {
  const ui = useUi();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [facets, setFacets] = useState<AuditLogFacets>(EMPTY_FACETS);
  /** O que os campos mostram; `applied` é o que a consulta usa (os campos de alvo esperam a digitação). */
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [applied, setApplied] = useState<Filters>(filters);
  const [moreFilters, setMoreFilters] = useState(false);
  /** Remonta os campos da barra quando os filtros mudam por fora (limpar, drawer), zerando a busca de usuário. */
  const [fieldsKey, setFieldsKey] = useState(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const consulta = useRef(0);

  useEffect(() => () => clearTimeout(typingTimer.current), []);

  const loadFacets = useCallback(() => {
    api.audit.facets().then(setFacets, () => {
      // Sem os valores, os filtros só ficam vazios; a consulta segue funcionando.
    });
  }, []);

  const query = useMemo(() => toQuery(applied), [applied]);

  const fetchData = useCallback(
    async (q: AuditLogFilter) => {
      const minha = ++consulta.current;
      setLoading(true);
      try {
        const rows = await api.audit.list(q);
        if (minha === consulta.current) setEntries(rows);
      } catch (err: unknown) {
        if (minha === consulta.current) {
          ui.feedback.notify({ type: "error", title: err instanceof Error ? err.message : "Erro ao carregar o Audit Log" });
        }
      } finally {
        if (minha === consulta.current) setLoading(false);
      }
    },
    [ui],
  );

  useEffect(loadFacets, [loadFacets]);
  useEffect(() => {
    void fetchData(query);
  }, [fetchData, query]);

  /** Aplica na hora; mudanças nos campos de alvo esperam a digitação parar. */
  const changeFilters = (next: Filters) => {
    const typing = next.targetType !== filters.targetType || next.targetId !== filters.targetId;
    setFilters(next);
    clearTimeout(typingTimer.current);
    if (typing) typingTimer.current = setTimeout(() => setApplied(next), TYPING_DELAY_MS);
    else setApplied(next);
  };

  const applyNow = (next: Filters) => {
    clearTimeout(typingTimer.current);
    setFilters(next);
    setApplied(next);
    setFieldsKey((k) => k + 1);
  };

  const refresh = () => {
    loadFacets();
    void fetchData(query);
  };

  const openFilters = async () => {
    const result = await ui.windows.open<Filters>({
      surface: "drawer",
      title: "Filtros",
      content: () => <FiltersDrawer initial={filters} facets={facets} />,
    });
    if (result.status === "confirmed") applyNow(result.value);
  };

  const others = describeOthers(applied);
  const printDescription = `Filtros: ${[`Período: ${describePeriod(applied.period)}`, ...others].join(" · ")}`;

  return (
    <Stack gap="section">
      <HeaderActions>
        <Button variant="outline" size="icon" aria-label="Atualizar" onClick={refresh} disabled={loading}>
          <Spin active={loading}><RefreshCw /></Spin>
        </Button>
      </HeaderActions>

      {/* Barra de filtros (desktop) */}
      <Show on="lgUp">
        <Stack surface="card" gap="section">
          <Stack direction="row" wrap align="end" gap="section">
            <FilterFields key={fieldsKey} idPrefix="audit" value={filters} onChange={changeFilters} facets={facets} showTarget={moreFilters} />
            <Stack direction="row" gap="field">
              <Button variant="outline" aria-expanded={moreFilters} onClick={() => setMoreFilters((v) => !v)}>
                <SlidersHorizontal />
                {moreFilters ? "Menos filtros" : "Mais filtros"}
              </Button>
              <Button variant="ghost" onClick={() => applyNow(defaultFilters())}>
                <FilterX />
                Limpar filtros
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </Show>

      {/* Resumo dos filtros (celular): os campos abrem num drawer */}
      <Show on="belowLg">
        <Stack direction="row" align="center" justify="between" gap="group" surface="card">
          <Stack gap="tight">
            <Text variant="small" weight="semibold" truncate>{describePeriod(applied.period)}</Text>
            <Text variant="caption" tone="muted" truncate>{others.length > 0 ? others.join(" · ") : "Todos os usuários e Plugins"}</Text>
          </Stack>
          <Stack direction="row" align="center" gap="field" shrink={false}>
            <Button variant="outline" size="icon" aria-label="Filtros" title="Filtros" onClick={() => void openFilters()}>
              <SlidersHorizontal />
            </Button>
          </Stack>
        </Stack>
      </Show>

      <DataTable
        scroll="page"
        columns={columns}
        rows={entries}
        getRowId={(e) => e.id}
        loading={loading}
        skeletonRows={5}
        title={(count) => `Audit Log (${count})`}
        search={{ placeholder: "Buscar..." }}
        description="Histórico de ações registradas por todo o sistema. Toque numa entrada para ver os atributos."
        emptyMessage="Nenhuma entrada encontrada."
        renderExpanded={(e) => <AuditEntryDetails entry={e} />}
        print={{ description: printDescription }}
      />
    </Stack>
  );
};
