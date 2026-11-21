import { Stack } from "@platform/ui/components/layout";
import { Tabs, TabsList, TabsTrigger } from "@platform/ui/components/tabs";
import { useTabParam } from "@platform/ui/hooks/use-tab-param";
import { PedidosLancamentoTab } from "./pedidos-lancamento-tab";
import { PedidosListasTab } from "./pedidos-listas-tab";
import { PedidosTab } from "./pedidos-tab";

/** Pedidos: o comprador lança o que comprar, mantém as listas de produtos e acompanha os Pedidos. */
export function PedidosPage() {
  const [aba, setAba] = useTabParam<"lancamento" | "listas" | "pedidos">(["lancamento", "listas", "pedidos"]);
  return (
    <Stack gap="section">
      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          <TabsTrigger value="lancamento">Lançamento</TabsTrigger>
          <TabsTrigger value="listas">Listas</TabsTrigger>
          <TabsTrigger value="pedidos">Pedidos</TabsTrigger>
        </TabsList>
      </Tabs>
      {aba === "pedidos" ? <PedidosTab /> : aba === "listas" ? <PedidosListasTab /> : <PedidosLancamentoTab />}
    </Stack>
  );
}
