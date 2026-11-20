import { useLayoutEffect, useRef } from "react";

/** Ref que sempre aponta para o valor mais recente, sem entrar nas dependências de effects. */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  // Layout effect: a ref já vale o render atual quando os effects do componente e dos filhos rodam.
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
