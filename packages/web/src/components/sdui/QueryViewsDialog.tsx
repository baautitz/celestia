import React, { useEffect, useMemo, useState } from "react";
import type { DashboardSchemaResponse } from "@platform/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setProfileSelections, useProfileSelections } from "@/hooks/use-query-profile-selection";
import {
  collectQueryViews,
  currentView,
  planForQuery,
  type ProfilePlan,
  type ViewComponent,
} from "@/lib/query-views";

interface QueryViewsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: DashboardSchemaResponse;
  workspaceId: string;
}

/** Componentes do Modelo que têm visões (perfis de dados) disponíveis para o usuário. */
export function getViewComponents(schema: DashboardSchemaResponse): ViewComponent[] {
  return (schema.ui?.components ?? [])
    .filter((component) => (component.props.availableProfiles?.length ?? 0) > 0)
    .map((component) => ({
      id: component.id,
      title: component.props.title ?? component.id,
      profiles: component.props.availableProfiles ?? [],
    }));
}

export const QueryViewsDialog: React.FC<QueryViewsDialogProps> = ({ open, onOpenChange, schema, workspaceId }) => {
  const components = useMemo(() => getViewComponents(schema), [schema]);
  const groups = useMemo(() => collectQueryViews(components), [components]);
  const readSelection = useProfileSelections(schema.id, workspaceId);

  // Rascunho: as escolhas só valem ao clicar em Concluir; fechar de outro jeito descarta.
  const [draft, setDraft] = useState<ProfilePlan>({});
  useEffect(() => {
    if (open) setDraft({});
  }, [open]);

  const selected = { ...Object.fromEntries(components.map((component) => [component.id, readSelection(component.id)])), ...draft };

  const conclude = () => {
    setProfileSelections(schema.id, workspaceId, draft);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Visões</DialogTitle>
          <DialogDescription>
            Escolha a visão de cada consulta: ao concluir, a mudança vale para todos os componentes que a usam. Cada
            componente também pode ser ajustado individualmente.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <FieldGroup className="py-2 pr-3">
            {groups.map((group) => {
              const current = currentView(group, components, selected);
              return (
                <Field key={group.key}>
                  <FieldLabel>
                    {group.sourceName} · {group.queryName}
                  </FieldLabel>
                  <Select
                    items={group.views.map((view) => ({ value: view.id, label: view.label }))}
                    value={current && current !== "mixed" ? current : null}
                    onValueChange={(viewId: string | null) => {
                      if (viewId) setDraft((current) => ({ ...current, ...planForQuery(group, components, viewId) }));
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={current === "mixed" ? "Misto (componentes com visões diferentes)" : "Selecione a visão"} />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false} className="w-max min-w-(--anchor-width)">
                      {group.views.map((view) => (
                        <SelectItem key={view.id} value={view.id}>
                          {view.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>Usada por: {group.components.map((item) => item.title).join(", ")}</FieldDescription>
                </Field>
              );
            })}

            {groups.length === 0 && (
              <FieldDescription>Este Modelo não tem consultas com visões para escolher.</FieldDescription>
            )}
          </FieldGroup>
        </ScrollArea>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={conclude}>
            Concluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
