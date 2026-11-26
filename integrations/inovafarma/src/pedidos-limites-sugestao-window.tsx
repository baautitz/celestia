import { useCallback, useEffect, useState } from "react";
import { Badge } from "@platform/ui/components/badge";
import { Stack, Text } from "@platform/ui/components/layout";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { FalhaAoCarregar } from "./contexto";
import { LIMITES_BASE } from "./pedidos-limites-comum";
import type { ProdutoSugerido, SugestaoDoLimite } from "./pedidos-limites-compra";

const dinheiro = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const colunas: DataTableColumn<ProdutoSugerido>[] = [
  { key: "codigo", label: "Código", value: (p) => p.codigoProduto ?? "", searchable: true, sortable: true, cellClassName: "font-mono text-xs" },
  { key: "nome", label: "Produto", value: (p) => p.nome, searchable: true, sortable: true, mobileRole: "primary", cellClassName: "w-full" },
  { key: "vendida", label: "Vendida", tooltip: "Vendida na vigência", format: "decimal", value: (p) => p.vendida, sortable: true },
  { key: "estoque", label: "Estoque", format: "decimal", value: (p) => p.estoque },
  { key: "aChegar", label: "A chegar", format: "decimal", value: (p) => p.aChegar },
  { key: "sugestao", label: "Sugestão", format: "decimal", value: (p) => p.sugestao, sortable: true },
  { key: "preco", label: "Últ. preço", tooltip: "Preço por unidade da última compra", format: "currency", value: (p) => p.preco },
  { key: "valor", label: "Valor", format: "currency", value: (p) => (p.valorCentavos === null ? null : p.valorCentavos / 100), sortable: true },
  {
    key: "cabe",
    label: "No saldo",
    value: (p) => (p.valorCentavos === null ? "Sem preço" : p.cabe ? "Cabe" : "Passa"),
    render: (p) => (p.valorCentavos === null ? <Badge variant="outline">Sem preço</Badge> : <Badge variant={p.cabe ? "secondary" : "destructive"}>{p.cabe ? "Cabe" : "Passa"}</Badge>),
  },
];

/** O que comprar de um saldo do Limite, produto a produto. */
export function SugestaoLimiteWindow({ valorId, codigoLoja }: { valorId: string; codigoLoja: number | null }) {
  const [sugestao, setSugestao] = useState<SugestaoDoLimite | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setFalha(null);
    try {
      setSugestao(await apiFetch<SugestaoDoLimite>(`${LIMITES_BASE}/valores/${valorId}/sugestao${codigoLoja === null ? "" : `?loja=${codigoLoja}`}`));
    } catch (err: unknown) {
      setFalha(err instanceof Error ? err.message : "Erro ao calcular a sugestão.");
    }
  }, [valorId, codigoLoja]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <>
      <Stack gap="field" viewport="modal">
        {falha ? (
          <FalhaAoCarregar titulo="Não foi possível calcular a sugestão" descricao={falha} onTentarNovamente={() => void carregar()} />
        ) : (
          <>
            {sugestao ? (
              <Stack direction="row" gap="group" shrink={false} surface="muted">
                {[
                  { rotulo: "Saldo do Limite", valor: sugestao.saldoCentavos },
                  { rotulo: "Sugestão total", valor: sugestao.totalCentavos },
                ].map((x) => (
                  <Stack key={x.rotulo}>
                    <Text variant="caption" tone="muted">{x.rotulo}</Text>
                    <Text weight="semibold">{dinheiro(x.valor)}</Text>
                  </Stack>
                ))}
              </Stack>
            ) : null}
            <Stack grow>
              <DataTable scroll="fill" columns={colunas} rows={sugestao?.produtos ?? []} loading={!sugestao} getRowId={(p) => p.produtoId} search={{ placeholder: "Buscar produto" }} emptyMessage="Nada a comprar: o estoque cobre as vendas da vigência." />
            </Stack>
          </>
        )}
      </Stack>
      <WindowActions>
        <WindowCancelButton>Fechar</WindowCancelButton>
      </WindowActions>
    </>
  );
}
