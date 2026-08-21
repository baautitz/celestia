import { useCallback, useEffect, useMemo, useState } from "react";
import type { Role, PermissionCatalog, PermissionItem, RecipePermissionGroup } from "@platform/shared";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Shield, ChevronDownIcon } from "lucide-react";

interface RecipePermissionsSheetProps {
  recipeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function RecipePermissionsSheet({
  recipeId,
  open,
  onOpenChange,
  onSaved,
}: RecipePermissionsSheetProps) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rolePermissions, setRolePermissions] = useState<Record<string, string[]>>({});
  const [originalPermissions, setOriginalPermissions] = useState<Record<string, string[]>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [rolesRes, catalogRes] = await Promise.all([
        api.iam.listRoles(),
        api.iam.getCatalog(),
      ]);
      setRoles(rolesRes);
      setCatalog(catalogRes);

      const permsMap: Record<string, string[]> = {};
      for (const r of rolesRes) {
        permsMap[r.id] = [...r.permissions];
      }
      setRolePermissions(permsMap);
      setOriginalPermissions(permsMap);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao carregar permissões.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open, fetchData]);

  const recipeGroup: RecipePermissionGroup | undefined = useMemo(() => {
    if (!catalog) return undefined;
    return catalog.recipes.find((r) => r.recipeId === recipeId);
  }, [catalog, recipeId]);

  const allRecipePermissions: PermissionItem[] = useMemo(() => {
    if (!recipeGroup) return [];
    return [
      recipeGroup.viewPermission,
      ...recipeGroup.queryPermissions,
      ...recipeGroup.actionPermissions,
    ];
  }, [recipeGroup]);

  const handleTogglePermission = (roleId: string, key: string, enabled: boolean) => {
    setRolePermissions((prev) => {
      const current = prev[roleId] || [];
      let updated: string[];
      if (enabled) {
        updated = [...current.filter((p) => p !== key && p !== "*"), key];
      } else {
        updated = current.filter((p) => p !== key && p !== "*");
      }
      return { ...prev, [roleId]: updated };
    });
  };

  const isPermActive = (roleId: string, key: string): boolean => {
    const perms = rolePermissions[roleId] || [];
    return perms.includes("*") || perms.includes(key);
  };

  const hasChanges = useMemo(() => {
    for (const roleId of Object.keys(rolePermissions)) {
      const current = (rolePermissions[roleId] || []).sort().join(",");
      const original = (originalPermissions[roleId] || []).sort().join(",");
      if (current !== original) return true;
    }
    return false;
  }, [rolePermissions, originalPermissions]);

  const countGranted = (roleId: string): number => {
    const perms = rolePermissions[roleId] || [];
    if (perms.includes("*")) return allRecipePermissions.length;
    return allRecipePermissions.filter((p) => perms.includes(p.key)).length;
  };

  const handleToggleGroup = (roleId: string) => {
    setExpandedGroups((prev) => ({ ...prev, [roleId]: !prev[roleId] }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const changedRoles: Promise<unknown>[] = [];

      for (const roleId of Object.keys(rolePermissions)) {
        const current = (rolePermissions[roleId] || []).sort().join(",");
        const original = (originalPermissions[roleId] || []).sort().join(",");
        if (current !== original) {
          changedRoles.push(
            api.iam.updateRole(roleId, { permissions: rolePermissions[roleId] })
          );
        }
      }

      await Promise.all(changedRoles);
      toast.success("Permissões do modelo atualizadas com sucesso!");
      setOriginalPermissions({ ...rolePermissions });
      onSaved?.();
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar permissões.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col p-0 sm:max-w-xl">
        <SheetHeader className=" border-b shrink-0">
          <SheetTitle>Permissões do Modelo</SheetTitle>
          <SheetDescription>
            Configure quais grupos podem acessar e executar ações neste Modelo.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 flex flex-col gap-4">
            {loading ? (
              <div className="flex flex-col gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : !recipeGroup ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nenhuma permissão declarada para este Modelo.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  {roles.map((role) => (
                    <Collapsible
                      key={role.id}
                      open={expandedGroups[role.id] || false}
                      onOpenChange={() => handleToggleGroup(role.id)}
                    >
                      <Card>
                        <CardContent className="py-0">
                          <CollapsibleTrigger
                            render={
                              <Button
                                variant="ghost"
                                className="w-full justify-between py-2 h-auto"
                              />
                            }
                          >
                            <div className="flex items-center gap-2">
                              <Shield className="size-3.5 text-primary" />
                              <span className="font-medium">{role.name}</span>
                              <Badge variant="secondary" className="font-mono text-xs">
                                {countGranted(role.id)}/{allRecipePermissions.length}
                              </Badge>
                            </div>
                            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180" />
                          </CollapsibleTrigger>

                          <CollapsibleContent className="flex flex-col gap-3 p-2">
                            {/* Acesso ao Modelo */}
                            <div className="flex flex-col gap-2">
                              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Acesso ao Modelo
                              </span>
                              <div className="flex items-center justify-between gap-4 py-2 border-b border-border/40">
                                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                  <span className="font-mono text-xs font-medium text-foreground break-all">
                                    {recipeGroup.viewPermission.key}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground">
                                    {recipeGroup.viewPermission.label}
                                  </span>
                                </div>
                                <Switch
                                  className="shrink-0"
                                  checked={isPermActive(role.id, recipeGroup.viewPermission.key)}
                                  onCheckedChange={(checked: boolean) =>
                                    handleTogglePermission(role.id, recipeGroup.viewPermission.key, checked)
                                  }
                                />
                              </div>
                            </div>

                            {/* Consultas */}
                            {recipeGroup.queryPermissions.length > 0 && (
                              <div className="flex flex-col gap-2">
                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  Consultas
                                </span>
                                {recipeGroup.queryPermissions.map((qp: PermissionItem) => (
                                  <div
                                    key={qp.key}
                                    className="flex items-center justify-between gap-4 py-2 border-b border-border/40"
                                  >
                                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                      <span className="font-mono text-xs font-medium text-foreground break-all">
                                        {qp.key}
                                      </span>
                                      <span className="text-[11px] text-muted-foreground">{qp.label}</span>
                                    </div>
                                    <Switch
                                      className="shrink-0"
                                      checked={isPermActive(role.id, qp.key)}
                                      onCheckedChange={(checked: boolean) =>
                                        handleTogglePermission(role.id, qp.key, checked)
                                      }
                                    />
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Ações */}
                            {recipeGroup.actionPermissions.length > 0 && (
                              <div className="flex flex-col gap-2">
                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  Ações
                                </span>
                                {recipeGroup.actionPermissions.map((ap: PermissionItem) => (
                                  <div
                                    key={ap.key}
                                    className="flex items-center justify-between gap-4 py-2"
                                  >
                                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                      <span className="font-mono text-xs font-medium text-foreground break-all">
                                        {ap.key}
                                      </span>
                                      <span className="text-[11px] text-muted-foreground">{ap.label}</span>
                                    </div>
                                    <Switch
                                      className="shrink-0"
                                      checked={isPermActive(role.id, ap.key)}
                                      onCheckedChange={(checked: boolean) =>
                                        handleTogglePermission(role.id, ap.key, checked)
                                      }
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                          </CollapsibleContent>
                        </CardContent>
                      </Card>
                    </Collapsible>
                  ))}
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        <SheetFooter className="p-6 border-t shrink-0 flex flex-row justify-end gap-2 bg-popover">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !hasChanges || loading}>
            {saving ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
