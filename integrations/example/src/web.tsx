import { Puzzle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@platform/ui/components/card";
import { defineWebModule } from "@platform/ui/contracts/module";

function ExamplePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Plugin de exemplo</CardTitle>
        <CardDescription>Esta tela vem da pasta de integrações e some do menu quando o Plugin sai da lista de Modules.</CardDescription>
      </CardHeader>
      <CardContent>Rota do Plugin: /api/m/example/hello</CardContent>
    </Card>
  );
}

/** Tela de menu do Plugin de exemplo. */
export const exampleWebModule = defineWebModule({
  id: "example",
  entries: [
    {
      id: "example",
      label: "Exemplo",
      title: "Plugin de exemplo",
      icon: Puzzle,
      path: "/example",
      group: "Plugins",
      permission: "example:note:read",
      component: ExamplePage,
    },
  ],
});
