import { useEffect, useState } from "react";
import { Stack } from "@platform/ui/components/layout";
import { Tabs, TabsList, TabsTrigger } from "@platform/ui/components/tabs";
import { useTabParam } from "@platform/ui/hooks/use-tab-param";
import { apiFetch } from "@platform/ui/lib/api";
import { API } from "./inovafarma-api";
import { FALTEIRO_BASE, type FalteiroWindowProps } from "./pedidos-falteiro-window";
import { PedidosFalteiroTab } from "./pedidos-falteiro-tab";
import { LIMITES_BASE, type CadastroLimites } from "./pedidos-limites-comum";
import { PedidosLimitesTab } from "./pedidos-limites-tab";
import { PedidosLancamentoTab } from "./pedidos-lancamento-tab";
import { PedidosTab } from "./pedidos-tab";

type Aba = "lancamento" | "pedidos" | "falteiro" | "limites";

interface AbasVisiveis {
  lancamento: boolean;
  pedidos: boolean;
  falteiro: boolean;
  limites: boolean;
}

/** Descobre quais abas o servidor libera para o Usuário atual. */
function useAbasPedidos(): AbasVisiveis {
  const [visiveis, setVisiveis] = useState<AbasVisiveis>({
    lancamento: true,
    pedidos: true,
    falteiro: false,
    limites: false,
  });

  useEffect(() => {
    let atual = true;
    void Promise.all([
      apiFetch<{ hoje?: string }>(`${API}/pedidos/lancamento/contexto`).then((r) => Boolean(r?.hoje)).catch(() => false),
      apiFetch<unknown>(`${API}/pedidos/pedidos`).then((r) => Array.isArray(r)).catch(() => false),
      apiFetch<{ itens?: FalteiroWindowProps["falta"][] }>(FALTEIRO_BASE).then((r) => Array.isArray(r?.itens)).catch(() => false),
      apiFetch<CadastroLimites>(LIMITES_BASE).then((r) => Array.isArray(r?.regras)).catch(() => false),
    ]).then(([lancamento, pedidos, falteiro, limites]) => {
      if (!atual) return;
      setVisiveis({ lancamento, pedidos, falteiro, limites });
    });
    return () => {
      atual = false;
    };
  }, []);

  return visiveis;
}

/** Pedidos: o comprador lança o que comprar, acompanha os Pedidos, o Falteiro e os Limites de Compras. */
export function PedidosPage() {
  const visiveis = useAbasPedidos();
  const listaAbas: (Aba | false)[] = [
    visiveis.lancamento && "lancamento",
    visiveis.pedidos && "pedidos",
    visiveis.falteiro && "falteiro",
    visiveis.limites && "limites",
  ];
  const [aba, setAba] = useTabParam<Aba>(listaAbas);

  if (!aba) return null;

  const abas = (
    <Tabs value={aba} onValueChange={setAba}>
      <TabsList>
        {visiveis.lancamento && <TabsTrigger value="lancamento">Lançamento</TabsTrigger>}
        {visiveis.pedidos && <TabsTrigger value="pedidos">Pedidos</TabsTrigger>}
        {visiveis.falteiro && <TabsTrigger value="falteiro">Falteiro</TabsTrigger>}
        {visiveis.limites && <TabsTrigger value="limites">Limites</TabsTrigger>}
      </TabsList>
    </Tabs>
  );
  if (aba === "lancamento") return <PedidosLancamentoTab abas={abas} />;
  return (
    <Stack gap="section">
      {abas}
      {aba === "pedidos" && <PedidosTab />}
      {aba === "falteiro" && <PedidosFalteiroTab />}
      {aba === "limites" && <PedidosLimitesTab />}
    </Stack>
  );
}
