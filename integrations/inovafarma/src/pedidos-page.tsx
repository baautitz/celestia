import { useEffect, useState } from "react";
import { Stack } from "@platform/ui/components/layout";
import { Tabs, TabsList, TabsTrigger } from "@platform/ui/components/tabs";
import { useTabParam } from "@platform/ui/hooks/use-tab-param";
import { apiFetch } from "@platform/ui/lib/api";
import { LIMITES_BASE, type CadastroLimites } from "./pedidos-limites-comum";
import { PedidosLimitesTab } from "./pedidos-limites-tab";
import { PedidosLancamentoTab } from "./pedidos-lancamento-tab";
import { PedidosTab } from "./pedidos-tab";

type Aba = "lancamento" | "pedidos" | "limites";

/** A aba Limites, com as Regras de Limite dentro, só aparece para quem o servidor deixa ver os Limites de Compras. */
function useVeLimites(): boolean {
  const [ve, setVe] = useState(false);
  useEffect(() => {
    let atual = true;
    apiFetch<CadastroLimites>(LIMITES_BASE)
      .then((r) => atual && setVe(Array.isArray(r?.regras)))
      .catch(() => undefined);
    return () => {
      atual = false;
    };
  }, []);
  return ve;
}

/** Pedidos: o comprador lança o que comprar, acompanha os Pedidos e os Limites de Compras. */
export function PedidosPage() {
  const veLimites = useVeLimites();
  const [aba, setAba] = useTabParam<Aba>(veLimites ? ["lancamento", "pedidos", "limites"] : ["lancamento", "pedidos"]);
  const abas = (
    <Tabs value={aba} onValueChange={setAba}>
      <TabsList>
        <TabsTrigger value="lancamento">Lançamento</TabsTrigger>
        <TabsTrigger value="pedidos">Pedidos</TabsTrigger>
        {veLimites && <TabsTrigger value="limites">Limites</TabsTrigger>}
      </TabsList>
    </Tabs>
  );
  if (aba === "lancamento") return <PedidosLancamentoTab abas={abas} />;
  return (
    <Stack gap="section">
      {abas}
      {aba === "pedidos" && <PedidosTab />}
      {aba === "limites" && <PedidosLimitesTab />}
    </Stack>
  );
}
