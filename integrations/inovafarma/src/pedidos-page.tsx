import { Stack } from "@platform/ui/components/layout";
import { Tabs, TabsList, TabsTrigger } from "@platform/ui/components/tabs";
import { useTabParam } from "@platform/ui/hooks/use-tab-param";
import { PedidosLancamentoTab } from "./pedidos-lancamento-tab";
import { PedidosTab } from "./pedidos-tab";

/** Pedidos: o comprador lança o que comprar. A aba Listas entra nas próximas fatias. */
export function PedidosPage() {
  const [aba, setAba] = useTabParam<"lancamento" | "pedidos">(["lancamento", "pedidos"]);
  return (
    <Stack gap="section">
      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          <TabsTrigger value="lancamento">Lançamento</TabsTrigger>
          <TabsTrigger value="pedidos">Pedidos</TabsTrigger>
        </TabsList>
      </Tabs>
      {aba === "pedidos" ? <PedidosTab /> : <PedidosLancamentoTab />}
    </Stack>
  );
}
