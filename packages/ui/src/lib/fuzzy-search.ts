/**
 * Busca por palavras, tolerante a acentos e a um erro de digitação, com pontuação de relevância.
 * Cada palavra da consulta precisa casar com algum campo; a pontuação é a soma da melhor forma de cada palavra.
 */

/** Pontos de cada forma de casar, da mais forte à mais fraca. */
const WHOLE_WORD = 4;
const WORD_PREFIX = 3;
const SUBSTRING = 2;
const ONE_TYPO = 1;
/** Abaixo disso, um erro de digitação casaria quase tudo. */
const MIN_TYPO_LENGTH = 4;

const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const tokenize = (text: string) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Distância de edição até 1: diz só se `a` e `b` diferem em no máximo uma letra (troca, falta ou sobra). */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** `word` casa `token` com um erro: inteiro, ou como começo de palavra ainda incompleta. */
function typoMatch(word: string, token: string): boolean {
  if (word.length < MIN_TYPO_LENGTH) return false;
  if (withinOneEdit(word, token)) return true;
  for (const len of [word.length - 1, word.length, word.length + 1]) {
    if (len < token.length && withinOneEdit(word, token.slice(0, len))) return true;
  }
  return false;
}

interface Field {
  text: string;
  tokens: string[];
}

function wordScore(word: string, fields: Field[]): number {
  let best = 0;
  for (const { text, tokens } of fields) {
    for (const token of tokens) {
      if (token === word) return WHOLE_WORD;
      if (token.startsWith(word)) best = Math.max(best, WORD_PREFIX);
    }
    if (best < SUBSTRING && text.includes(word)) best = SUBSTRING;
    if (best < ONE_TYPO && tokens.some((t) => typoMatch(word, t))) best = ONE_TYPO;
  }
  return best;
}

/** Pontuação de `query` nos campos; `null` quando alguma palavra não casa. Consulta vazia casa tudo com 0. */
export function searchScore(query: string, fields: string[]): number | null {
  const words = tokenizeQuery(query);
  if (words.length === 0) return 0;
  const prepared = fields.map((f) => {
    const text = normalize(f);
    return { text, tokens: tokenize(text) };
  });
  let total = 0;
  for (const word of words) {
    const score = wordScore(word, prepared);
    if (score === 0) return null;
    total += score;
  }
  return total;
}

const tokenizeQuery = (query: string) => normalize(query).split(/\s+/).filter(Boolean);

/** Filtra as linhas que casam com `query` e as ordena da mais relevante à menos; o empate mantém a ordem original. */
export function rankBySearch<T>(rows: T[], query: string, fields: (row: T) => string[]): T[] {
  if (tokenizeQuery(query).length === 0) return rows;
  return rows
    .map((row, index) => ({ row, index, score: searchScore(query, fields(row)) }))
    .filter((r): r is { row: T; index: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.row);
}
