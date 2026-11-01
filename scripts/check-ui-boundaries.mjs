import ts from "typescript"
import { readFileSync } from "node:fs"
import { glob } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const rootArg = process.argv.indexOf("--root")
const root = rootArg > -1 ? resolve(process.argv[rootArg + 1]) : resolve(fileURLToPath(new URL("..", import.meta.url)))
const windowModules = /^@platform\/ui\/components\/(dialog|sheet|alert-dialog|popover)$/
const forbiddenTags = new Set([
  "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "aside", "header", "footer",
  "main", "nav", "ul", "ol", "li", "label", "strong", "em", "small", "b", "i", "pre", "code",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "img", "hr", "dl", "dt", "dd", "figure", "figcaption",
  "picture", "video", "audio", "canvas", "blockquote", "br", "fieldset", "legend", "details", "summary",
])
const allowedButtonSizes = new Set(["default", "icon"])
/** Campos de data e hora nativos do navegador: a biblioteca tem DatePicker e DateRangePicker. */
const nativeDateInputTypes = new Set(["date", "month", "week", "time", "datetime-local"])
const violations = []

for await (const rel of glob("{packages/*/src/**/*.{ts,tsx},integrations/**/*.{ts,tsx}}", { cwd: root })) {
  const file = rel.split(sep).join("/")
  if (file.startsWith("packages/ui/") || /(^|\/)(node_modules|dist)\//.test(file)) continue
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
  const styledObjects = new Set()
  const hasStyleKey = (obj) =>
    ts.isObjectLiteralExpression(obj) &&
    obj.properties.some((p) => p.name && ["className", "style"].includes(p.name.getText(source)))
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && hasStyleKey(node.initializer)) {
      styledObjects.add(node.name.text)
    }
    ts.forEachChild(node, collect)
  }
  collect(source)
  const visitJsx = (node) => {
    if (ts.isJsxOpeningLikeElement(node)) {
      const tag = node.tagName.getText(source)
      if (forbiddenTags.has(tag)) report(node, `elemento HTML intrinseco <${tag}> (use componentes de @platform/ui)`)
      for (const attr of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attr)) {
          const e = attr.expression
          if (hasStyleKey(e) || (ts.isIdentifier(e) && styledObjects.has(e.text))) {
            report(attr, "className/style em props espalhadas fora de @platform/ui")
          }
          continue
        }
        if (!ts.isJsxAttribute(attr)) continue
        const name = attr.name.getText(source)
        if (name === "className" || name === "style") report(attr, `${name} em JSX fora de @platform/ui`)
        if (name === "type" && /^[Ii]nput$/.test(tag)) {
          const init = attr.initializer
          const expr = init && ts.isJsxExpression(init) ? init.expression : init
          if (expr && ts.isStringLiteralLike(expr) && nativeDateInputTypes.has(expr.text)) {
            report(attr, `<${tag} type="${expr.text}"> nativo (use DatePicker, DateRangePicker ou MonthPicker de @platform/ui/components/*)`)
          }
        }
        if (/(^|[a-z])Button$/.test(tag) && name === "size") {
          const init = attr.initializer
          const expr = init && ts.isJsxExpression(init) ? init.expression : init
          const value = expr && ts.isStringLiteralLike(expr) ? expr.text : undefined
          if (value === undefined || !allowedButtonSizes.has(value)) {
            report(attr, `${tag} size deve ser "default" ou "icon" (literal)`)
          }
        }
      }
      if (windowTags.has(tag)) {
        for (const attr of node.attributes.properties) {
          if (ts.isJsxAttribute(attr) && (attr.name.text === "open" || attr.name.text === "onOpenChange")) {
            report(attr, `${attr.name.text} declarativo em ${tag}`)
          }
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
