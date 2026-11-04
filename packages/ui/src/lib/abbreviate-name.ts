/** Partículas que ligam os sobrenomes ("de", "da"...): somem quando o sobrenome seguinte vira inicial. */
const PARTICLES = new Set(["de", "da", "do", "das", "dos", "e", "di", "del", "van", "von"]);

/**
 * Abrevia um nome pela regra do passaporte: o primeiro nome e o último sobrenome ficam inteiros, e os do meio viram
 * iniciais, do último para o primeiro, só até caber em `maxLength`. A partícula antes do último sobrenome fica
 * ("Alan Cristian Muller de Oliveira" → "Alan C. M. de Oliveira"); as do meio somem com o sobrenome abreviado.
 */
export function abbreviateName(name: string, maxLength: number): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const join = (parts: (string | null)[]) => parts.filter((p): p is string => p !== null).join(" ");
  if (words.length <= 2 || name.trim().length <= maxLength) return join(words);

  const last = words.length - 1;
  // A partícula logo antes do último sobrenome faz parte dele.
  const lastStart = PARTICLES.has(words[last - 1]!.toLowerCase()) && last - 1 > 0 ? last - 1 : last;
  const parts: (string | null)[] = [...words];
  for (let i = lastStart - 1; i >= 1; i--) {
    const word = words[i]!;
    if (PARTICLES.has(word.toLowerCase())) continue;
    parts[i] = `${word[0]!.toUpperCase()}.`;
    // A partícula que ligava esta palavra à anterior some junto.
    if (i - 1 >= 1 && PARTICLES.has(words[i - 1]!.toLowerCase())) parts[i - 1] = null;
    if (join(parts).length <= maxLength) break;
  }
  return join(parts);
}
