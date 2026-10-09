import type { ComponentProfileMeta } from "@platform/shared";

/** Componente da tela com os perfis de dados (cada perfil = uma combinação de visões das consultas dele). */
export interface ViewComponent {
  id: string;
  title: string;
  profiles: ComponentProfileMeta[];
}

/** Visão = uma opção de uma consulta (ex.: "Todas", "Somente as minhas vendas"). */
export interface QueryView {
  id: string;
  label: string;
}

export interface QueryViewGroup {
  key: string;
  sourceName: string;
  queryName: string;
  views: QueryView[];
  components: { id: string; title: string }[];
}

/** Escolha de perfil por componente (id do componente -> id do perfil). */
export type ProfilePlan = Record<string, string>;

const groupKey = (sourceName: string, queryName: string) => `${sourceName}.${queryName}`;

/** Varre os componentes e agrupa por consulta (fonte + nome), com as visões e os componentes que a usam. */
export function collectQueryViews(components: ViewComponent[]): QueryViewGroup[] {
  const groups = new Map<string, QueryViewGroup>();

  for (const component of components) {
    for (const profile of component.profiles) {
      for (const binding of profile.bindings) {
        if (!binding.sourceName || !binding.queryName || !binding.optionId) continue;
        const key = groupKey(binding.sourceName, binding.queryName);
        const group = groups.get(key) ?? {
          key,
          sourceName: binding.sourceName,
          queryName: binding.queryName,
          views: [],
          components: [],
        };
        if (!group.views.some((view) => view.id === binding.optionId)) {
          group.views.push({ id: binding.optionId, label: binding.optionLabel || binding.optionId });
        }
        if (!group.components.some((item) => item.id === component.id)) {
          group.components.push({ id: component.id, title: component.title });
        }
        groups.set(key, group);
      }
    }
  }
  return Array.from(groups.values());
}

/** Perfil em uso: o escolhido, se ainda for válido; senão o primeiro. */
export function effectiveProfileId(component: ViewComponent, selectedProfileId?: string): string | undefined {
  return component.profiles.some((profile) => profile.id === selectedProfileId) ? selectedProfileId : component.profiles[0]?.id;
}

/** Visão atual de um grupo: o id da visão, ou "mixed" se os componentes divergem. */
export function currentView(
  group: QueryViewGroup,
  components: ViewComponent[],
  selected: Record<string, string | undefined>
): string | "mixed" | undefined {
  const used = new Set<string>();
  for (const item of group.components) {
    const component = components.find((candidate) => candidate.id === item.id);
    if (!component) continue;
    const profile = component.profiles.find((candidate) => candidate.id === effectiveProfileId(component, selected[component.id]));
    const binding = profile?.bindings.find((candidate) => candidate.sourceName === group.sourceName && candidate.queryName === group.queryName);
    if (binding?.optionId) used.add(binding.optionId);
  }
  if (used.size === 0) return undefined;
  return used.size === 1 ? Array.from(used)[0] : "mixed";
}

/** Perfil do componente que usa a visão pedida na consulta (o primeiro que combinar). */
function profileFor(component: ViewComponent, matches: (binding: ComponentProfileMeta["bindings"][number]) => boolean): string | undefined {
  return component.profiles.find((profile) => profile.bindings.some(matches))?.id;
}

/** Aplica uma visão a todos os componentes de UMA consulta. */
export function planForQuery(group: QueryViewGroup, components: ViewComponent[], viewId: string): ProfilePlan {
  const plan: ProfilePlan = {};
  for (const item of group.components) {
    const component = components.find((candidate) => candidate.id === item.id);
    const profileId =
      component &&
      profileFor(
        component,
        (binding) => binding.sourceName === group.sourceName && binding.queryName === group.queryName && binding.optionId === viewId
      );
    if (profileId) plan[item.id] = profileId;
  }
  return plan;
}

/** Override geral: aplica a visão (pelo id) em todas as consultas que a tenham; as demais ficam como estão. */
export function planForAll(components: ViewComponent[], viewId: string): ProfilePlan {
  const plan: ProfilePlan = {};
  for (const component of components) {
    const profileId = profileFor(component, (binding) => binding.optionId === viewId);
    if (profileId) plan[component.id] = profileId;
  }
  return plan;
}

/** Visões que podem ser aplicadas a todas as consultas de uma vez (união pelo id). */
export function allViews(groups: QueryViewGroup[]): QueryView[] {
  const views = new Map<string, QueryView>();
  for (const group of groups) for (const view of group.views) if (!views.has(view.id)) views.set(view.id, view);
  return Array.from(views.values());
}
