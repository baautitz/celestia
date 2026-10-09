import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ComponentProfileMeta } from "@platform/shared";

const STORAGE_VERSION = "v1";

interface UseQueryProfileSelectionOptions {
  recipeId: string;
  workspaceId: string;
  componentId: string;
  profiles?: ComponentProfileMeta[];
}

const storageKeyOf = (recipeId: string, workspaceId: string, componentId: string) =>
  `celestia:query-profile:${STORAGE_VERSION}:${encodeURIComponent(recipeId)}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(componentId)}`;

function readStoredProfile(storageKey: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(storageKey) || undefined;
  } catch {
    return undefined;
  }
}

function writeStoredProfile(storageKey: string, profileId: string): void {
  try {
    window.localStorage.setItem(storageKey, profileId);
  } catch {
    // Preferência local é opcional em modo privado ou quando o storage está bloqueado.
  }
}

// Store compartilhado: componentes e o modal de Visões enxergam a mesma escolha, e mudar uma atualiza a tela toda.
const selections = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

function getSelection(storageKey: string): string | undefined {
  if (!selections.has(storageKey)) {
    const stored = readStoredProfile(storageKey);
    if (stored) selections.set(storageKey, stored);
  }
  return selections.get(storageKey);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function applySelections(entries: Array<[string, string]>): void {
  for (const [storageKey, profileId] of entries) {
    selections.set(storageKey, profileId);
    writeStoredProfile(storageKey, profileId);
  }
  version += 1;
  listeners.forEach((listener) => listener());
}

/** Define de uma vez o perfil de vários componentes (id do componente -> id do perfil). */
export function setProfileSelections(recipeId: string, workspaceId: string, plan: Record<string, string>): void {
  applySelections(Object.entries(plan).map(([componentId, profileId]) => [storageKeyOf(recipeId, workspaceId, componentId), profileId]));
}

/** Lê as escolhas atuais (e re-renderiza quando qualquer uma mudar). */
export function useProfileSelections(recipeId: string, workspaceId: string): (componentId: string) => string | undefined {
  useSyncExternalStore(subscribe, () => version);
  return (componentId) => getSelection(storageKeyOf(recipeId, workspaceId, componentId));
}

export function useQueryProfileSelection({
  recipeId,
  workspaceId,
  componentId,
  profiles = [],
}: UseQueryProfileSelectionOptions): [string | undefined, (profileId: string) => void] {
  const storageKey = useMemo(() => storageKeyOf(recipeId, workspaceId, componentId), [recipeId, workspaceId, componentId]);
  const stored = useSyncExternalStore(subscribe, () => getSelection(storageKey));

  // A escolha guardada só vale se o perfil ainda existir (o usuário pode ter perdido a permissão); senão, o primeiro.
  const profileId = profiles.some((profile) => profile.id === stored) ? stored : profiles[0]?.id;

  const selectProfile = useCallback((nextProfileId: string) => applySelections([[storageKey, nextProfileId]]), [storageKey]);

  return [profileId, selectProfile];
}
