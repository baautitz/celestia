import ts from "typescript"
import { readFileSync } from "node:fs"
import { glob } from "node:fs/promises"
import { dirname, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

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
  const source = ts.createSourceFile(file, readFileSync(resolve(root, file), "utf8"), ts.ScriptTarget.Latest, true)
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
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
      violations.push(`${file}:${line + 1} - ${problem}`)
    }
  }
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      check(node, node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      check(node, node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

if (violations.length) {
  console.error("Fronteira de Plugin violada:\n" + violations.sort().join("\n"))
  process.exitCode = 1
} else {
  console.log("Fronteiras de Plugin verificadas sem violacoes.")
}
