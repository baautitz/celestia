import type { NavEntry, WebModule } from "@platform/ui/contracts/module";
import { canSeeEntry } from "./entry-screen";

export interface MenuSectionView {
  id: string;
  label: string;
  entries: NavEntry[];
}

/** Ordem crescente por `order`; ausente vale "depois de todos"; empate mantém a ordem de registro (sort estável). */
const byOrder = (a: { order?: number }, b: { order?: number }): number =>
  (a.order ?? Infinity) === (b.order ?? Infinity) ? 0 : (a.order ?? Infinity) < (b.order ?? Infinity) ? -1 : 1;

/**
 * Monta o menu: Seções ordenadas com as entradas que o User pode ver.
 * Lança se duas Seções tiverem o mesmo `id` ou se uma entrada apontar para Seção não declarada.
 */
export const buildMenu = (
  modules: WebModule[],
  hasPermission: (permission: string) => boolean,
): MenuSectionView[] => {
  const sections = new Map<string, { id: string; label: string; order?: number; moduleId: string }>();
  for (const m of modules) {
    for (const s of m.sections ?? []) {
      const prev = sections.get(s.id);
      if (prev) {
        throw new Error(`Seção do Menu "${s.id}" declarada por "${prev.moduleId}" e "${m.id}"`);
      }
      sections.set(s.id, { ...s, moduleId: m.id });
    }
  }

  const entries = modules.flatMap((m) => m.entries);
  for (const e of entries) {
    if (!sections.has(e.section)) {
      throw new Error(`Entrada "${e.id}" aponta para a Seção do Menu "${e.section}", que nenhum módulo declarou`);
    }
  }

  const visible = entries.filter((e) => canSeeEntry(e, hasPermission));
  return [...sections.values()]
    .sort(byOrder)
    .map((s) => ({
      id: s.id,
      label: s.label,
      entries: visible.filter((e) => e.section === s.id).sort(byOrder),
    }))
    .filter((s) => s.entries.length > 0);
};
