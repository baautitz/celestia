import { Stack } from "@platform/ui/components/layout";
import { Tabs, TabsList, TabsTrigger } from "@platform/ui/components/tabs";
import { useTabParam } from "@platform/ui/hooks/use-tab-param";
import { PedidosLancamentoTab } from "./pedidos-lancamento-tab";

/** Pedidos: o comprador lança o que comprar. As abas Listas e Pedidos entram nas próximas fatias. */
export function PedidosPage() {
  const [aba, setAba] = useTabParam<"lancamento">(["lancamento"]);
  return (
    <Stack gap="section">
      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          <TabsTrigger value="lancamento">Lançamento</TabsTrigger>
        </TabsList>
      </Tabs>
      <PedidosLancamentoTab />
    </Stack>
  );
}
