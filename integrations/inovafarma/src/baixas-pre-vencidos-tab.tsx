import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Label } from "@platform/ui/components/label";
import { Stack } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { formatDate } from "@platform/ui/lib/format";
import type { LojaOpcao } from "./pre-vencido-window";

const BASE = "/api/m/inovafarma/pre-vencidos";

interface Periodo {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status?: "open" | "closed";
}

/** Uma Baixa: a venda do ERP e quanto dela foi Pré-vencido. */
interface Baixa {
  vendaId: number;
  /** Hora do ERP, `AAAA-MM-DD HH:MM:SS`. */
  data: string;
  produtoId: string;
  nomeProduto: string;
  codigoBarra: string | null;
  quantidadeVendida: number;
  quantidade: number;
}

interface BaixasDoColaborador {
  codigoColaborador: number;
  nomeColaborador: string;
  quantidade: number;
  vendas: Baixa[];
}

/** `AAAA-MM-DD HH:MM:SS` (hora do ERP) como `DD/MM/AAAA HH:MM`, sem conversão de fuso. */
export const dataHora = (data: string) => {
  const [dia = "", hora = ""] = data.split(" ");
  return `${dia.split("-").reverse().join("/")} ${hora.slice(0, 5)}`.trim();
};
const periodoLabel = (p: Periodo) => `${p.name} (${formatDate(p.startDate)} a ${formatDate(p.endDate)})${p.status === "closed" ? " · fechado" : ""}`;

const colunasVenda: DataTableColumn<Baixa>[] = [
  { key: "venda", label: "Venda", value: (b) => String(b.vendaId) },
  { key: "data", centered: true, label: "Data", value: (b) => b.data, render: (b) => dataHora(b.data) },
  { key: "produto", label: "Produto", value: (b) => b.nomeProduto },
  { key: "vendida", label: "Qtde vendida", value: (b) => b.quantidadeVendida, format: "number" },
  { key: "quantidade", label: "Baixa", value: (b) => b.quantidade, format: "number" },
];

/** Aba Baixas: as Baixas de Pré-vencido de uma Loja do Vínculo num Closing Period, por Colaborador e abertas por venda. */
export function BaixasPreVencidosTab({ lojas, periodos }: { lojas: LojaOpcao[]; periodos: Periodo[] }) {
  const { feedback } = useUi();
  const [loja, setLoja] = useState(lojas.length > 0 ? String(lojas[0]!.codigo) : "");
  // Abre no período aberto de data mais recente; sem nenhum aberto, no mais recente.
  const [periodoId, setPeriodoId] = useState((periodos.find((p) => p.status !== "closed") ?? periodos[0])?.id ?? "");
  const [grupos, setGrupos] = useState<BaixasDoColaborador[]>([]);
  const [carregando, setCarregando] = useState(false);

  // Só a resposta da última consulta vale.
  const consulta = useRef(0);
  useEffect(() => {
    if (!loja || !periodoId) return;
    const minha = ++consulta.current;
    setCarregando(true);
    apiFetch<BaixasDoColaborador[]>(`${BASE}/baixas?codigoLoja=${encodeURIComponent(loja)}&periodoId=${encodeURIComponent(periodoId)}`)
      .then((recebidos) => {
        if (minha === consulta.current) setGrupos(recebidos);
      })
      .catch((err: unknown) => {
        if (minha === consulta.current) feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar as Baixas."));
      })
      .finally(() => {
        if (minha === consulta.current) setCarregando(false);
      });
  }, [loja, periodoId, feedback]);

  if (lojas.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Sem Lojas</AlertTitle>
        <AlertDescription>Seu Usuário não está vinculado a um Colaborador com Lojas. Peça o vínculo a quem administra os Colaboradores.</AlertDescription>
      </Alert>
    );
  }

  const colunas: DataTableColumn<BaixasDoColaborador>[] = [
    { key: "colaborador", label: "Colaborador", value: (g) => g.nomeColaborador, searchable: true, sortable: true },
    { key: "vendas", label: "Vendas", value: (g) => g.vendas.length, format: "number", sortable: true },
    { key: "quantidade", label: "Pré-vencidos vendidos", value: (g) => g.quantidade, format: "number", sortable: true },
  ];

  return (
    <Stack gap="section">
      <Stack direction="row" align="end" gap="section" wrap>
        <Stack gap="field">
          <Label>Loja</Label>
          <Select value={loja} onValueChange={(v) => v && setLoja(v)}>
            <SelectTrigger aria-label="Loja">
              <SelectValue>{(v: string) => lojas.find((l) => String(l.codigo) === v)?.nome || `Loja ${v}`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {lojas.map((l) => (
                <SelectItem key={l.codigo} value={String(l.codigo)}>
                  {l.nome || `Loja ${l.codigo}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Stack>
        <Stack gap="field">
          <Label>Período de Fechamento</Label>
          <Select value={periodoId} onValueChange={(v) => v && setPeriodoId(v)}>
            <SelectTrigger aria-label="Período de Fechamento">
              <SelectValue>{(id: string) => periodos.find((p) => p.id === id)?.name ?? "Selecione"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {periodos.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {periodoLabel(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Stack>
      </Stack>
      <DataTable
        scroll="page"
        columns={colunas}
        rows={grupos}
        getRowId={(g) => String(g.codigoColaborador)}
        loading={carregando}
        title="Baixas de Pré-vencido"
        description="As vendas da Loja no período que gastaram o Estoque de Pré-vencidos, por Colaborador."
        emptyMessage="Nenhuma Baixa nesta Loja no período."
        search={{ placeholder: "Buscar Colaborador" }}
        renderExpanded={(g) => <DataTable scroll="page" columns={colunasVenda} rows={g.vendas} getRowId={(b) => `${b.vendaId}|${b.produtoId}`} />}
      />
    </Stack>
  );
}
