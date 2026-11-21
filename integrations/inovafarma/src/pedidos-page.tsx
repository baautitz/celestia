import { Stack } from "@platform/ui/components/layout";
import { Tabs, TabsList, TabsTrigger } from "@platform/ui/components/tabs";
import { useTabParam } from "@platform/ui/hooks/use-tab-param";
import { PedidosLancamentoTab } from "./pedidos-lancamento-tab";
import { PedidosListasTab } from "./pedidos-listas-tab";

/** Pedidos: o comprador lança o que comprar e mantém as listas de produtos. A aba Pedidos entra nas próximas fatias. */
export function PedidosPage() {
  const [aba, setAba] = useTabParam<"lancamento" | "listas">(["lancamento", "listas"]);
  return (
    <Stack gap="section">
      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          <TabsTrigger value="lancamento">Lançamento</TabsTrigger>
          <TabsTrigger value="listas">Listas</TabsTrigger>
        </TabsList>
      </Tabs>
      {aba === "listas" ? <PedidosListasTab /> : <PedidosLancamentoTab />}
    </Stack>
  );
}
