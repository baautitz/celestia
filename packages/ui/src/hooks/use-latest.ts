import { useEffect, useRef } from "react";

/** Ref que sempre aponta para o valor mais recente, sem entrar nas dependências de effects. */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
