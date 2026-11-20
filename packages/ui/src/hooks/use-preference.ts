import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { useLatest } from "./use-latest";

const path = (key: string) => `/api/iam/preferences/${encodeURIComponent(key)}`;

/**
 * Preferência do Usuário logado guardada no servidor (p.ex. a visualização escolhida numa tela).
 * Começa com `defaultValue`, troca pelo valor salvo quando ele chega e salva em segundo plano a cada mudança.
 * `accept` descarta um valor salvo que a tela não reconhece mais.
 */
export function usePreference<T>(key: string, defaultValue: T, accept?: (value: unknown) => value is T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(defaultValue);
  // Escolhido antes de a leitura voltar: a escolha vale, não o que estava salvo.
  const chosen = useRef(false);
  // `accept` costuma ser uma função nova a cada render: lido pela ref, só a chave dispara a leitura.
  const acceptRef = useLatest(accept);
  useEffect(() => {
    let alive = true;
    chosen.current = false;
    apiFetch<{ value: unknown }>(path(key))
      .then((r) => {
        if (!alive || chosen.current || r.value === null || r.value === undefined) return;
        const accepts = acceptRef.current;
        if (!accepts || accepts(r.value)) setValue(r.value as T);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key, acceptRef]);
  const update = useCallback(
    (next: T) => {
      chosen.current = true;
      setValue(next);
      void apiFetch(path(key), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: next }),
      }).catch(() => undefined);
    },
    [key],
  );
  return [value, update];
}
