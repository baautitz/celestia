/** Partículas de nome: não contam como nome em comum. */
const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e"]);

function nomesDe(nome: string): string[] {
  const normalizado = nome.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return normalizado.split(/[^\p{L}\p{N}]+/u).filter((n) => n !== "" && !PARTICULAS.has(n));
}

/** Nome contido no outro, com o mesmo primeiro nome e ao menos dois nomes em comum. */
function compativel(a: string[], b: string[]): boolean {
  const [menor, maior] = a.length <= b.length ? [a, b] : [b, a];
  return menor.length >= 2 && menor[0] === maior[0] && menor.every((n) => maior.includes(n));
}

function candidatoClaro(nome: string, usuarios: { id: string; nomes: string[] }[]): string | null {
  const nomes = nomesDe(nome);
  const identicos = usuarios.filter((u) => nomes.length >= 2 && u.nomes.join(" ") === nomes.join(" "));
  const candidatos = identicos.length > 0 ? identicos : usuarios.filter((u) => compativel(nomes, u.nomes));
  return candidatos.length === 1 ? candidatos[0]!.id : null;
}

/**
 * Usuário sugerido a cada Colaborador: só com um único candidato claro.
 * Um Usuário que serviria a dois Colaboradores não é sugerido a nenhum, pois só pode ter um vínculo.
 */
export function sugerirUsuarios(colaboradores: { codigoColaborador: number; nome: string }[], usuarios: { id: string; fullname: string }[]): Map<number, string> {
  const comNomes = usuarios.map((u) => ({ id: u.id, nomes: nomesDe(u.fullname) }));
  const sugeridos = colaboradores.flatMap((c) => {
    const id = candidatoClaro(c.nome, comNomes);
    return id === null ? [] : [{ codigo: c.codigoColaborador, id }];
  });
  const vezes = new Map<string, number>();
  for (const { id } of sugeridos) vezes.set(id, (vezes.get(id) ?? 0) + 1);
  return new Map(sugeridos.filter(({ id }) => vezes.get(id) === 1).map(({ codigo, id }) => [codigo, id]));
}
