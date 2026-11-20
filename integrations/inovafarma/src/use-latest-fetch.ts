import { useCallback, useRef } from "react";

/**
 * Só a resposta da última consulta vale: uma resposta atrasada não apaga o que uma consulta mais nova trouxe.
 * Cada chamada de `novaConsulta()` invalida as anteriores e devolve `vale()`, que diz se esta ainda é a última.
 */
export function useLatestFetch(): () => () => boolean {
  const ultima = useRef(0);
  return useCallback(() => {
    const minha = ++ultima.current;
    return () => minha === ultima.current;
  }, []);
}
