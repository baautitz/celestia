import { Stack } from "@platform/ui/components/layout";
import { Tabs, TabsList, TabsTrigger } from "@platform/ui/components/tabs";
import { useTabParam } from "@platform/ui/hooks/use-tab-param";
import { PedidosLancamentoTab } from "./pedidos-lancamento-tab";
import { PedidosTab } from "./pedidos-tab";

/** Pedidos: o comprador lança o que comprar, acompanha os Pedidos. */
export function PedidosPage() {
  const [aba, setAba] = useTabParam<"lancamento" | "pedidos">(["lancamento", "pedidos"]);
  const abas = (
    <Tabs value={aba} onValueChange={setAba}>
      <TabsList>
        <TabsTrigger value="lancamento">Lançamento</TabsTrigger>
        <TabsTrigger value="pedidos">Pedidos</TabsTrigger>
      </TabsList>
    </Tabs>
  );
  if (aba === "lancamento") return <PedidosLancamentoTab abas={abas} />;
  return (
    <Stack gap="section">
      {abas}
      <PedidosTab />
    </Stack>
  );
}
