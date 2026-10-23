import { Pill } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@platform/ui/components/card";
import { defineWebModule } from "@platform/ui/contracts/module";

function InovafarmaPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>InovaFarma</CardTitle>
        <CardDescription>Integração com o ERP InovaFarma via banco de dados MSSQL.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Módulo de integração ativo. Utilize esta seção para consultar operações e relatórios integrados.
        </p>
      </CardContent>
    </Card>
  );
}

/** Tela e item de menu do Plugin InovaFarma. */
export const inovafarmaWebModule = defineWebModule({
  id: "inovafarma",
  entries: [
    {
      id: "inovafarma",
      label: "InovaFarma",
      title: "InovaFarma",
      icon: Pill,
      path: "/inovafarma",
      group: "Plugins",
      permission: "inovafarma:integration:view",
      component: InovafarmaPage,
    },
  ],
});
