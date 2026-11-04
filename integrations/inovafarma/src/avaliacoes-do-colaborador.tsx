import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { Button } from "@platform/ui/components/button";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { dataHora } from "./datas";

/** Quem pode ler as Avaliações: quem gerencia (as das Lojas dele) ou o próprio Colaborador (as dele). */
export type AcessoAvaliacoes = "gerenciar" | "minhas";

interface AvaliacaoLida {
  id: string;
  codigoLoja: number;
  descricao: string;
  valor: number;
  criadoEm: string;
  lancadoPor?: string;
}

/** As Avaliações do Colaborador no Período, só para leitura: o atalho das Metas de Avaliações. */
function AvaliacoesDoColaboradorWindow({ periodoId, codigoColaborador, acesso }: { periodoId: string; codigoColaborador: number; acesso: AcessoAvaliacoes }) {
  const { feedback } = useUi();
  const [linhas, setLinhas] = useState<AvaliacaoLida[] | null>(null);
  useEffect(() => {
    const url =
      acesso === "minhas"
        ? `/api/m/inovafarma/avaliacoes/minhas?periodoId=${encodeURIComponent(periodoId)}`
        : `/api/m/inovafarma/avaliacoes?periodoId=${encodeURIComponent(periodoId)}&codigoColaborador=${codigoColaborador}`;
    apiFetch<AvaliacaoLida[]>(url)
      .then(setLinhas)
      .catch((err: unknown) => {
        setLinhas([]);
        feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar as Avaliações."));
      });
  }, [periodoId, codigoColaborador, acesso, feedback]);

  const colunas: DataTableColumn<AvaliacaoLida>[] = [
    { key: "data", centered: true, label: "Data", value: (a) => a.criadoEm, render: (a) => dataHora(a.criadoEm), sortable: true },
    { key: "loja", label: "Loja", value: (a) => `Loja ${a.codigoLoja}` },
    { key: "descricao", label: "Descrição", value: (a) => a.descricao, cellClassName: "min-w-64 whitespace-normal", mobileRole: "primary" },
    { key: "valor", label: "Valor", value: (a) => a.valor, format: "currency", sortable: true },
    ...(acesso === "gerenciar" ? [{ key: "lancadoPor", label: "Lançado por", value: (a: AvaliacaoLida) => a.lancadoPor ?? "" }] : []),
  ];
  return (
    <>
      <DataTable
        scroll="page"
        columns={colunas}
        rows={linhas ?? []}
        loading={linhas === null}
        getRowId={(a) => a.id}
        emptyMessage="Nenhuma Avaliação neste Período."
        totals={(rows) => ({ descricao: "Total descontado", valor: rows.reduce((acc, a) => acc + a.valor, 0) })}
      />
      <WindowActions>
        <WindowCancelButton>Fechar</WindowCancelButton>
      </WindowActions>
    </>
  );
}

/** Olho que abre as Avaliações do Colaborador; só aparece para quem já pode lê-las. */
export function OlhoAvaliacoes({ periodoId, codigoColaborador, nome, acesso }: { periodoId: string; codigoColaborador: number; nome: string; acesso: AcessoAvaliacoes | null }) {
  const { windows } = useUi();
  if (!acesso) return null;
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={`Ver as Avaliações de ${nome}`}
      onClick={(e) => {
        e.stopPropagation();
        void windows.open({
          surface: "sheet",
          title: "Avaliações",
          description: `${nome} · descontadas do valor inicial da Meta de Avaliações.`,
          content: () => <AvaliacoesDoColaboradorWindow periodoId={periodoId} codigoColaborador={codigoColaborador} acesso={acesso} />,
        });
      }}
    >
      <Eye />
    </Button>
  );
}
