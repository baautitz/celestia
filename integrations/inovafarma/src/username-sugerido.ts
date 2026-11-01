import { nomesDe } from "./sugestao-usuario";

/** Username sugerido para o Nome Completo: as duas primeiras palavras, sem conectores nem acentos, em minúsculas e com `_`. */
export const sugerirUsername = (nomeCompleto: string): string => nomesDe(nomeCompleto).slice(0, 2).join("_");
