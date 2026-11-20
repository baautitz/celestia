import { readFileSync } from "node:fs"
import { glob } from "node:fs/promises"
import { dirname, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { lineOf, parse, stringValue, walk } from "./ast.mjs"

// Um Plugin (integrations/<nome>) só pode importar o Core (@platform/core), a UI (@platform/ui),
// bibliotecas de terceiros e arquivos da própria pasta. Servidor e web ficam de fora.
const rootArg = process.argv.indexOf("--root")
const root = rootArg > -1 ? resolve(process.argv[rootArg + 1]) : resolve(fileURLToPath(new URL("..", import.meta.url)))
const allowedScopes = /^@platform\/(core|ui)(\/|$)/
const violations = []

for await (const rel of glob("integrations/*/**/*.{ts,tsx,mjs,js}", { cwd: root })) {
  const file = rel.split(sep).join("/")
  if (file.includes("/node_modules/") || file.includes("/dist/")) continue
  const pluginDir = resolve(root, file.split("/").slice(0, 2).join("/"))
  const code = readFileSync(resolve(root, file), "utf8")
  const program = parse(file, code)
  const check = (node, name) => {
    let problem
    if (name.startsWith(".")) {
      const target = resolve(dirname(resolve(root, file)), name)
      if (relative(pluginDir, target).startsWith("..")) problem = `import "${name}" fora do Plugin`
    } else if (name.startsWith("@platform/") && !allowedScopes.test(name)) {
      problem = `import de ${name.split("/").slice(0, 2).join("/")} (só @platform/core e @platform/ui são permitidos)`
    } else if (name.startsWith("@/")) {
      problem = `import de ${name} (alias do web)`
    }
    if (problem) {
      violations.push(`${file}:${lineOf(code, node)} - ${problem}`)
    }
  }
  walk(program, (node) => {
    if (node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration") {
      if (node.source && typeof node.source.value === "string") check(node, node.source.value)
    } else if (node.type === "ImportExpression") {
      const name = stringValue(node.source)
      if (name !== undefined) check(node, name)
    }
  })
}

if (violations.length) {
  console.error(`Fronteira de Plugin violada:\n${violations.sort().join("\n")}`)
  process.exitCode = 1
} else {
  console.log("Fronteiras de Plugin verificadas sem violacoes.")
}
