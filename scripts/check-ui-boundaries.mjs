import ts from "typescript"
import { readFileSync } from "node:fs"
import { glob } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const windowModules = /^@platform\/ui\/components\/(dialog|sheet|alert-dialog|popover)$/
const violations = []

for await (const rel of glob("packages/*/src/**/*.{ts,tsx}", { cwd: root })) {
  const file = rel.split(sep).join("/")
  if (file.startsWith("packages/ui/") || file.includes("/node_modules/")) continue
  const source = ts.createSourceFile(file, readFileSync(resolve(root, file), "utf8"), ts.ScriptTarget.Latest, true)
  const windowTags = new Set()
  const report = (node, label) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
    violations.push(`${file}:${line + 1} - ${label}`)
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const name = node.moduleSpecifier.text
      if (name === "sonner") report(node, "import direto de sonner")
      if (name.startsWith("@base-ui/react")) report(node, "import direto de @base-ui/react")
      if (name.startsWith("@/components/ui")) report(node, "import de @/components/ui (legado)")
      const bindings = node.importClause?.namedBindings
      if (windowModules.test(name) && bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) windowTags.add(el.name.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  const visitJsx = (node) => {
    if (ts.isJsxOpeningLikeElement(node) && windowTags.has(node.tagName.getText(source))) {
      for (const attr of node.attributes.properties) {
        if (ts.isJsxAttribute(attr) && (attr.name.text === "open" || attr.name.text === "onOpenChange")) {
          report(attr, `${attr.name.text} declarativo em ${node.tagName.getText(source)}`)
        }
      }
    }
    ts.forEachChild(node, visitJsx)
  }
  visitJsx(source)
}

if (violations.length) {
  console.error("Fronteira da UI violada:\n" + violations.sort().join("\n"))
  process.exitCode = 1
} else {
  console.log("Fronteiras da UI verificadas sem violacoes.")
}
