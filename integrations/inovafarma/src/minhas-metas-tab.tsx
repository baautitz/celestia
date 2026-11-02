import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Badge } from "@platform/ui/components/badge";
import { Label } from "@platform/ui/components/label";
import { Stack } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import type { MinhaMeta } from "./minhas-metas";
import type { PeriodoMetas } from "./montar-metas-tab";

interface MinhasMetas {
  congelada: boolean;
  metas: MinhaMeta[];
}

/** O resultado na Exibição do Tipo de Meta; o servidor já cortou o que o Colaborador não vê. */
function resultado(m: MinhaMeta): string {
  if (m.contagem) return m.contagem;
  if (m.realizado === undefined) return "";
  const alvo = m.alvo ? ` de ${m.alvo}` : "";
  return `Realizado ${m.realizado}${alvo}${m.falta ? ` · faltam ${m.falta}` : ""}`;
}

const colunas: DataTableColumn<MinhaMeta>[] = [
  { key: "meta", label: "Meta", value: (m) => m.nome, searchable: true, sortable: true, nowrap: true, mobileRole: "primary" },
  { key: "resultado", label: "Resultado", value: resultado },
  {
    key: "situacao",
    label: "Situação",
    value: (m) => (m.atingida === null ? "" : m.atingida ? "Atingida" : "Não atingida"),
    render: (m) => (m.atingida === null ? null : <Badge variant={m.atingida ? "default" : "outline"}>{m.atingida ? "Atingida" : "Não atingida"}</Badge>),
  },
  { key: "premio", label: "Prêmio", value: (m) => (m.premioCentavos === undefined ? null : m.premioCentavos / 100), format: "currency" },
];

const periodoInicial = (periodos: PeriodoMetas[]) => (periodos.find((p) => p.status === "open") ?? periodos[0])?.id ?? "";

/** Aba Minhas Metas: as Metas do Colaborador vinculado ao Usuário, na Exibição de cada Tipo de Meta. Sem impressão. */
export function MinhasMetas({ periodos }: { periodos: PeriodoMetas[] }) {
  const { feedback } = useUi();
  const [periodoId, setPeriodoId] = useState(() => periodoInicial(periodos));
  const [dados, setDados] = useState<MinhasMetas | null>(null);
  const [carregando, setCarregando] = useState(false);
  const consulta = useRef(0);

  const carregar = useCallback(async () => {
    if (!periodoId) return;
    const minha = ++consulta.current;
    setCarregando(true);
    try {
      const d = await apiFetch<MinhasMetas>(`/api/m/inovafarma/metas/minhas?periodoId=${encodeURIComponent(periodoId)}`);
      if (minha === consulta.current) setDados(d);
    } catch (err: unknown) {
      if (minha === consulta.current) {
        setDados(null);
        feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar as suas Metas."));
      }
    } finally {
      if (minha === consulta.current) setCarregando(false);
    }
  }, [periodoId, feedback]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (periodos.length === 0)
    return (
      <Alert>
        <AlertTitle>Nenhum Período de Fechamento</AlertTitle>
        <AlertDescription>Ainda não há Período de Fechamento com Metas.</AlertDescription>
      </Alert>
    );

  return (
    <Stack gap="section">
      <Stack gap="field">
        <Label>Período de Fechamento</Label>
        <Select value={periodoId} onValueChange={(v) => v && setPeriodoId(v)}>
          <SelectTrigger aria-label="Período de Fechamento">
            <SelectValue>{(id: string) => periodos.find((p) => p.id === id)?.name ?? "Selecione"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {periodos.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.status === "closed" ? " · fechado" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Stack>
      <DataTable
        columns={colunas}
        rows={dados?.metas ?? []}
        getRowId={(m) => m.metaId}
        loading={carregando}
        title="Minhas Metas"
        description={dados?.congelada ? "Período fechado: resultado gravado no fechamento." : "O resultado acompanha as vendas do ERP até o fechamento do Período."}
        emptyMessage="Você não participa de nenhuma Meta neste Período."
        striped
      />
    </Stack>
  );
}
