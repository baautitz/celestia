// Tradução pt-BR da interface do Monaco: precisa ser carregada antes do próprio editor.
import "monaco-editor/nls/lang/pt-br";
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";

self.MonacoEnvironment = {
  getWorker: (_id, label) =>
    label === "typescript" || label === "javascript" ? new TsWorker() : new EditorWorker(),
};

// Tipos de @platform/shared direto do código-fonte, sempre sincronizados com o `defineRecipe` real.
const sharedTypes = import.meta.glob<string>("../../../shared/src/types/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

const { typescriptDefaults, ModuleKind, ModuleResolutionKind, ScriptTarget } = monaco.typescript;
const SHARED_ROOT = "file:///node_modules/@platform/shared";

// Sem isso o worker só enxerga o modelo aberto e não resolve definições nos tipos de @platform/shared.
typescriptDefaults.setEagerModelSync(true);

typescriptDefaults.setCompilerOptions({
  target: ScriptTarget.ES2020,
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.NodeJs,
  strict: true,
  noEmit: true,
  allowNonTsExtensions: true,
});

for (const [path, content] of Object.entries(sharedTypes)) {
  const name = path.split("/").pop();
  // Modelos (e não extraLibs) para que F12 / Ctrl+clique abram a definição dos tipos.
  monaco.editor.createModel(content, "typescript", monaco.Uri.parse(`${SHARED_ROOT}/src/types/${name}`));
}
monaco.editor.createModel(
  `export * from "./src/types/index";`,
  "typescript",
  monaco.Uri.parse(`${SHARED_ROOT}/index.d.ts`)
);
typescriptDefaults.addExtraLib(
  JSON.stringify({ name: "@platform/shared", types: "index.d.ts" }),
  `${SHARED_ROOT}/package.json`
);

loader.config({ monaco });

// O editor standalone não navega para outro modelo (F12 / Ctrl+clique não fazem nada);
// abrimos a definição em um peek inline, que funciona entre modelos.
monaco.editor.registerEditorOpener({
  openCodeEditor: (source) => {
    source.getAction("editor.action.peekDefinition")?.run();
    return true;
  },
});

// Tema claro com o fundo levemente acinzentado.
monaco.editor.defineTheme("celestia-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: { "editor.background": "#f6f6f6" },
});
