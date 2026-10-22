import type { ComponentType } from "react";
import type { NavEntry } from "@platform/ui/contracts/module";

type HasPermission = (permission: string) => boolean;

/** Primeira variante (ordem de declaração) cuja Permission o User possui; senão a tela padrão se tiver a Permission da entrada; senão null (nega). */
export const resolveEntryScreen = (entry: NavEntry, hasPermission: HasPermission): ComponentType | null => {
  const variant = entry.variants?.find((v) => hasPermission(v.permission));
  if (variant) return variant.component;
  return hasPermission(entry.permission) ? entry.component : null;
};

/** A entrada aparece se o User tem a Permission da entrada ou de alguma variante. */
export const canSeeEntry = (entry: NavEntry, hasPermission: HasPermission): boolean =>
  hasPermission(entry.permission) || (entry.variants?.some((v) => hasPermission(v.permission)) ?? false);
