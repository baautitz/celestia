import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";

const PARAM = "tab";

/**
 * Aba ativa guardada em `?tab=`, para sobreviver ao recarregar e ir no link.
 * `visiveis` são as abas que o usuário pode ver, em ordem (`false` fica de fora, para abas condicionadas a Permission);
 * a primeira é a padrão e fica fora da URL.
 * Aba ausente, inválida, sem permissão ou igual à padrão cai na padrão, e a URL é corrigida com `replace`.
 * Com nenhuma aba visível (contexto ainda carregando) devolve `undefined` e não mexe na URL.
 * O setter aceita qualquer string (o `onValueChange` de `<Tabs>`); valor fora de `visiveis` vira a padrão.
 */
export function useTabParam<T extends string>(
  visiveis: readonly (T | false | null | undefined)[],
): [T | undefined, (aba: string) => void] {
  const [params, setParams] = useSearchParams();
  const abas = visiveis.filter((a): a is T => !!a);
  const naUrl = params.get(PARAM);
  const padrao = abas[0];
  const valida = naUrl !== null && (abas as readonly string[]).includes(naUrl);
  const aba = valida ? (naUrl as T) : padrao;
  const corrigir = naUrl !== null && padrao !== undefined && (!valida || naUrl === padrao);
  const chave = abas.join(",");

  const gravar = useCallback(
    (nova: string | null) => {
      setParams(
        (atual) => {
          const proximo = new URLSearchParams(atual);
          if (nova === null) proximo.delete(PARAM);
          else proximo.set(PARAM, nova);
          return proximo;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  useEffect(() => {
    if (corrigir) gravar(null);
  }, [corrigir, gravar]);

  const setAba = useCallback(
    (nova: string) => {
      const permitidas = chave.split(",");
      gravar(nova !== permitidas[0] && permitidas.includes(nova) ? nova : null);
    },
    [chave, gravar],
  );

  return [aba, setAba];
}
