/** Linha devolvida por `INSERT ... RETURNING`: a instrução que chegou até aqui sempre devolve uma. */
export function returned<T>(row: T | undefined): T {
  if (row === undefined) throw new Error("A instrução não devolveu a linha esperada.");
  return row;
}
