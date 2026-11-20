import { useCallback, useSyncExternalStore } from "react";

/** Período como as telas dos Plugins o recebem; só o que a seleção precisa. */
export interface SelectablePeriod {
  id: string;
  status: "open" | "closed";
}

const STORAGE_KEY = "celestia:closing-period";
const URL_PARAM = "periodo";

const listeners = new Set<() => void>();
let selected: string | null | undefined;

const readStored = (): string | null => {
  try {
    return new URLSearchParams(window.location.search).get(URL_PARAM) ?? window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const getSelected = (): string | null => {
  if (selected === undefined) selected = readStored();
  return selected;
};

/** Grava a escolha no estado compartilhado, no localStorage e no `?periodo=` da URL atual. */
export function selectPeriod(id: string): void {
  selected = id;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
    const url = new URL(window.location.href);
    url.searchParams.set(URL_PARAM, id);
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // Sem storage ou URL gravável a escolha vale só na memória.
  }
  for (const listener of listeners) listener();
}

/** Zera o estado em memória (testes). */
export function resetPeriodSelection(): void {
  selected = undefined;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** A última escolha se ainda estiver na lista; senão o período aberto mais recente (a lista vem do mais recente ao mais antigo), ou o primeiro. */
export const resolvePeriodId = (periods: SelectablePeriod[], chosen: string | null): string =>
  (periods.find((p) => p.id === chosen) ?? periods.find((p) => p.status !== "closed") ?? periods[0])?.id ?? "";

/** Período selecionado, compartilhado entre telas, e o setter. */
export function useSelectedPeriod(periods: SelectablePeriod[]): [string, (id: string) => void] {
  const chosen = useSyncExternalStore(subscribe, getSelected, () => null);
  const set = useCallback((id: string) => selectPeriod(id), []);
  return [resolvePeriodId(periods, chosen), set];
}
