import { readFileSync } from "node:fs"
import { glob } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { lineOf, parse, stringValue, walk } from "./ast.mjs"

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
  const code = readFileSync(resolve(root, file), "utf8")
  const program = parse(file, code)
  const text = (node) => code.slice(node.start, node.end)
  const windowTags = new Set()
  const report = (node, label) => {
    violations.push(`${file}:${lineOf(code, node)} - ${label}`)
  }
  walk(program, (node) => {
    if (node.type !== "ImportDeclaration") return
    const name = node.source.value
    if (name === "sonner") report(node, "import direto de sonner")
    if (name === "@platform/ui/components/toggle-group") report(node, "botoes segmentados (troca de visao usa Tabs de @platform/ui/components/tabs)")
    if (name.startsWith("@base-ui/react")) report(node, "import direto de @base-ui/react")
    if (name.startsWith("@/components/ui")) report(node, "import de @/components/ui (legado)")
    if (windowModules.test(name)) {
      for (const el of node.specifiers) if (el.type === "ImportSpecifier") windowTags.add(el.local.name)
    }
  })
  const styledObjects = new Set()
  const hasStyleKey = (obj) =>
    obj.type === "ObjectExpression" &&
    obj.properties.some(
      (p) => p.type === "Property" && !p.computed && p.key.type === "Identifier" && ["className", "style"].includes(p.key.name),
    )
  walk(program, (node) => {
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init && hasStyleKey(node.init)) {
      styledObjects.add(node.id.name)
    }
  })
  /** Valor de um atributo JSX quando é um literal de string (`a="x"`, `a={"x"}` ou `a={`x`}`). */
  const literalValue = (attr) => {
    const init = attr.value
    return stringValue(init && init.type === "JSXExpressionContainer" ? init.expression : init)
  }
  walk(program, (node) => {
    if (node.type !== "JSXOpeningElement") return
    const tag = text(node.name)
    if (forbiddenTags.has(tag)) report(node, `elemento HTML intrinseco <${tag}> (use componentes de @platform/ui)`)
    for (const attr of node.attributes) {
      if (attr.type === "JSXSpreadAttribute") {
        const e = attr.argument
        if (hasStyleKey(e) || (e.type === "Identifier" && styledObjects.has(e.name))) {
          report(attr, "className/style em props espalhadas fora de @platform/ui")
        }
        continue
      }
      const name = text(attr.name)
      if (name === "className" || name === "style") report(attr, `${name} em JSX fora de @platform/ui`)
      if (name === "type" && /^[Ii]nput$/.test(tag)) {
        const value = literalValue(attr)
        if (value !== undefined && nativeDateInputTypes.has(value)) {
          report(attr, `<${tag} type="${value}"> nativo (use DatePicker, DateRangePicker ou MonthPicker de @platform/ui/components/*)`)
        }
        if (value === "password") {
          report(attr, `<${tag} type="password"> (use PasswordInput de @platform/ui/components/password-input)`)
        }
      }
      if (/(^|[a-z])Button$/.test(tag) && name === "size") {
        const value = literalValue(attr)
        if (value === undefined || !allowedButtonSizes.has(value)) {
          report(attr, `${tag} size deve ser "default" ou "icon" (literal)`)
        }
      }
    }
    if (windowTags.has(tag)) {
      for (const attr of node.attributes) {
        if (attr.type === "JSXAttribute" && attr.name.type === "JSXIdentifier" && (attr.name.name === "open" || attr.name.name === "onOpenChange")) {
          report(attr, `${attr.name.name} declarativo em ${tag}`)
        }
      }
    }
  })
}

if (violations.length) {
  console.error(`Fronteira da UI violada:\n${violations.sort().join("\n")}`)
  process.exitCode = 1
} else {
  console.log("Fronteiras da UI verificadas sem violacoes.")
}
