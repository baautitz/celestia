import { useEffect, useState } from "react";
import { Stack, Text } from "@platform/ui/components/layout";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { apiFetch } from "@platform/ui/lib/api";
import { json } from "./inovafarma-api";
import { LIMITES_BASE, nomeDaLoja } from "./pedidos-limites-comum";
import type { Estouro } from "./pedidos-limites-compra";
import type { LojaOpcao } from "./loja-opcao";

/** Espera quem está marcando parar antes de consultar o ERP. */
const ESPERA_MS = 600;

export interface ParcelaSimulada {
  produtoId: string;
  codigoLoja: number;
  codigoFornecedor: number;
  quantidade: number;
}

/** Os Limites que a escolha atual ultrapassa, relidos a cada mudança; `falhou` quando não deu para conferir. */
export function useEstouros(pedidoId: string, parcelas: ParcelaSimulada[] | null) {
  const [estado, setEstado] = useState<{ estouros: Estouro[]; falhou: boolean }>({ estouros: [], falhou: false });
  const corpo = parcelas ? JSON.stringify(parcelas) : null;
  useEffect(() => {
    if (corpo === null) return;
    let atual = true;
    const espera = setTimeout(() => {
      apiFetch<Estouro[]>(`${LIMITES_BASE}/simular`, json("POST", { pedidoId, parcelas: JSON.parse(corpo) as ParcelaSimulada[] }))
        .then((estouros) => atual && setEstado({ estouros: Array.isArray(estouros) ? estouros : [], falhou: false }))
        .catch(() => atual && setEstado({ estouros: [], falhou: true }));
    }, ESPERA_MS);
    return () => {
      atual = false;
      clearTimeout(espera);
    };
  }, [pedidoId, corpo]);
  return estado;
}

export function AvisoDeLimites({ estouros, falhou, lojas }: { estouros: Estouro[]; falhou: boolean; lojas: LojaOpcao[] }) {
  if (falhou) return <Text tone="warning">Não foi possível conferir os Limites de Compras.</Text>;
  if (estouros.length === 0) return null;
  const emReais = (key: string, label: string, centavos: (e: Estouro) => number): DataTableColumn<Estouro> => ({ key, label, format: "currency", value: (e) => centavos(e) / 100 });
  return (
    <Stack gap="tight" shrink={false} role="alert">
      <Text tone="warning" weight="semibold">
        Este Pedido ultrapassa {estouros.length === 1 ? "um Limite de Compras" : `${estouros.length} Limites de Compras`}. A confirmação continua liberada.
      </Text>
      <DataTable
        compact
        embedded
        columns={[
          { key: "regra", label: "Regra", value: (e) => e.regra, mobileRole: "primary", cellClassName: "w-full" },
          { key: "loja", label: "Loja", value: (e) => (e.codigoLoja === null ? "Todas as Lojas" : nomeDaLoja(lojas, e.codigoLoja)) },
          emReais("saldo", "Saldo", (e) => e.saldoCentavos),
          emReais("pedido", "Este Pedido", (e) => e.pedidoCentavos),
          emReais("excede", "Passa em", (e) => e.excedeCentavos),
        ]}
        rows={estouros}
        getRowId={(e) => `${e.regra}|${e.codigoLoja}`}
      />
    </Stack>
  );
}
