import { parseSync } from "oxc-parser"

/** Analisa um arquivo (ts, tsx, js, mjs) e devolve a AST ESTree/JSX com posições de caractere. */
export function parse(file, code) {
  return parseSync(file, code).program
}

/** Visita cada nó da árvore, em profundidade, na ordem do código. */
export function walk(node, fn) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, fn)
  } else if (node && typeof node === "object" && typeof node.type === "string") {
    fn(node)
    for (const key in node) if (key !== "type") walk(node[key], fn)
  }
}

/** Linha (a partir de 1) em que o nó começa, sem contar o espaço antes dele. */
export function lineOf(code, node) {
  let line = 1
  for (let i = code.indexOf("\n"); i !== -1 && i < node.start; i = code.indexOf("\n", i + 1)) line++
  return line
}

/** Texto de um literal de string, ou de um template sem substituições; senão undefined. */
export function stringValue(node) {
  if (!node) return undefined
  if (node.type === "Literal" && typeof node.value === "string") return node.value
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked
  return undefined
}
