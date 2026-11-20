/** O nome já existe (sem diferenciar maiúsculas): o store é quem garante, e a rota responde 409. */
export class NomeDuplicadoError extends Error {}

/** Comparação de nomes do Plugin: sem diferenciar maiúsculas, como o índice único `lower(nome)` do Postgres. */
export const mesmoNome = (a: string, b: string): boolean => a.toLocaleLowerCase("pt-BR") === b.toLocaleLowerCase("pt-BR");

/** O erro do Postgres pode vir embrulhado pelo drizzle: procura na cadeia de `cause` uma violação de unicidade da restrição (ou índice) `nome`. */
export function violouRestricao(err: unknown, nome: string): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    if ("code" in e && e.code === "23505" && "constraint" in e && e.constraint === nome) return true;
  }
  return false;
}
