import { useEffect, useState } from "react";
import { Stack } from "@platform/ui/components/layout";
import { Tabs, TabsList, TabsTrigger } from "@platform/ui/components/tabs";
import { useTabParam } from "@platform/ui/hooks/use-tab-param";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { BaixasPreVencidosTab } from "./baixas-pre-vencidos-tab";
import { EstoquePreVencidosTab } from "./estoque-pre-vencidos-tab";
import type { LojaOpcao } from "./loja-opcao";
import type { InclusaoRetroativa } from "./item-pre-vencido-window";

const BASE = "/api/m/inovafarma/pre-vencidos";

interface Periodo {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status?: "open" | "closed";
}

interface Contexto {
  podeEstoque: boolean;
  podeBaixas: boolean;
  /** Closing Periods, o de data mais recente primeiro. */
  periodos: Periodo[];
  /** Lojas do Vínculo, do Estoque e das Baixas. */
  lojas: LojaOpcao[];
  /** Só para quem gere as Baixas: os limites da data de inclusão retroativa, calculados pelo servidor. */
  inclusaoRetroativa?: InclusaoRetroativa;
}

/** Tela Pré-vencidos: o Estoque de cada Loja e as Baixas que as vendas do ERP fazem nele. */
export function PreVencidosPage() {
  const { feedback } = useUi();
  const [contexto, setContexto] = useState<Contexto | null>(null);
  const [aba, setAba] = useTabParam<"estoque" | "baixas">(contexto ? [contexto.podeEstoque && "estoque", contexto.podeBaixas && "baixas"] : []);

  useEffect(() => {
    apiFetch<Contexto>(`${BASE}/contexto`)
      .then(setContexto)
      .catch((err: unknown) => feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar os Pré-vencidos.")));
  }, [feedback]);

  if (!contexto || !aba) return null;
  return (
    <Stack gap="section">
      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          {contexto.podeEstoque && <TabsTrigger value="estoque">Estoque</TabsTrigger>}
          {contexto.podeBaixas && <TabsTrigger value="baixas">Baixas</TabsTrigger>}
        </TabsList>
      </Tabs>
      {aba === "estoque" ? (
        <EstoquePreVencidosTab lojas={contexto.lojas} retroativa={contexto.inclusaoRetroativa} />
      ) : (
        <BaixasPreVencidosTab lojas={contexto.lojas} periodos={contexto.periodos} />
      )}
    </Stack>
  );
}
