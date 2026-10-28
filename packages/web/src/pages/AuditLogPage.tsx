import React, { useCallback, useEffect, useState } from "react";
import type { AuditLogEntry, AuditLogFilter } from "@platform/shared";
import { Button } from "@platform/ui/components/button";
import { Spin } from "@platform/ui/components/layout";
import { Badge } from "@platform/ui/components/badge";
import { Input } from "@platform/ui/components/input";
import { Field, FieldGroup } from "@platform/ui/components/field";
import { Label } from "@platform/ui/components/label";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { formatDate } from "@platform/ui/lib/format";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api-client";
import { HeaderActions } from "@/context/HeaderActionsContext";

const formatDateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR");

const FILTER_FIELDS: { key: keyof AuditLogFilter; label: string; type?: "date" }[] = [
  { key: "targetType", label: "Tipo do alvo" },
  { key: "targetId", label: "Id do alvo" },
  { key: "actorId", label: "Id do usuário" },
  { key: "plugin", label: "Plugin" },
  { key: "from", label: "De", type: "date" },
  { key: "to", label: "Até", type: "date" },
];

const columns: DataTableColumn<AuditLogEntry>[] = [
  {
    key: "occurredAt",
    label: "Quando",
    value: (e) => formatDateTime(e.occurredAt),
    cellClassName: "text-xs text-muted-foreground",
    skeletonClassName: "h-4 w-32",
  },
  {
    key: "actor",
    label: "Quem",
    value: (e) => e.actorName,
    mobileRole: "primary",
    cellClassName: "font-medium",
    skeletonClassName: "h-4 w-28",
  },
  {
    key: "plugin",
    label: "Plugin",
    value: (e) => e.plugin,
    render: (e) => <Badge variant="secondary">{e.plugin}</Badge>,
    skeletonClassName: "h-5 w-16",
  },
  {
    key: "summary",
    label: "Resumo",
    value: (e) => e.summary,
    mobileRole: "secondary",
    skeletonClassName: "h-4 w-48",
  },
  {
    key: "target",
    label: "Alvo",
    value: (e) => `${e.targetType} ${e.targetId}`,
    cellClassName: "font-mono text-xs",
    skeletonClassName: "h-4 w-32",
  },
];

export const AuditLogPage: React.FC = () => {
  const ui = useUi();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<AuditLogFilter>({});
  const [applied, setApplied] = useState<AuditLogFilter>({});

  const fetchData = useCallback(
    async (filter: AuditLogFilter) => {
      try {
        setLoading(true);
        setEntries(await api.audit.list(filter));
      } catch (err: unknown) {
        ui.feedback.notify({ type: "error", title: err instanceof Error ? err.message : "Erro ao carregar o Audit Log" });
      } finally {
        setLoading(false);
      }
    },
    [ui],
  );

  useEffect(() => {
    void fetchData(applied);
  }, [fetchData, applied]);

  const activeFilters = FILTER_FIELDS.flatMap(({ key, label, type }) => {
    const value = applied[key];
    return value ? [`${label}: ${type === "date" ? formatDate(value) : value}`] : [];
  });
  const printDescription = activeFilters.length > 0 ? `Filtros: ${activeFilters.join(" · ")}` : "Sem filtros.";

  return (
    <>
      <HeaderActions>
        <Button variant="outline" size="icon" onClick={() => void fetchData(applied)} disabled={loading}>
          <Spin active={loading}><RefreshCw /></Spin>
        </Button>
      </HeaderActions>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(draft);
        }}
      >
        <FieldGroup>
          {FILTER_FIELDS.map(({ key, label, type }) => (
            <Field key={key}>
              <Label htmlFor={`audit-${key}`}>{label}</Label>
              <Input
                id={`audit-${key}`}
                type={type}
                value={draft[key] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              />
            </Field>
          ))}
          <Field>
            <Button type="submit">Filtrar</Button>
          </Field>
        </FieldGroup>
      </form>

      <DataTable
        columns={columns}
        rows={entries}
        getRowId={(e) => e.id}
        loading={loading}
        skeletonRows={5}
        title={(count) => `Audit Log (${count})`}
        description="Histórico de ações registradas por todo o sistema. Filtre por alvo, usuário, Plugin e data."
        emptyMessage="Nenhuma entrada encontrada."
        print={{ description: printDescription }}
      />
    </>
  );
};
