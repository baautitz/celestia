import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Button } from "@platform/ui/components/button";
import { Label } from "@platform/ui/components/label";
import { Stack } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { apiFetch } from "@platform/ui/lib/api";

interface Colaborador {
  codigoColaborador: number;
  nome: string;
  ativo: boolean;
}

/** Resposta em objeto: a listagem ganha opções de Usuário e Loja junto dos Colaboradores. */
interface ListaColaboradores {
  colaboradores: Colaborador[];
}

type Situacao = "ativos" | "todos";

const SITUACAO_LABEL: Record<Situacao, string> = { ativos: "Ativos", todos: "Todos" };

const columns: DataTableColumn<Colaborador>[] = [
  {
    key: "codigoColaborador",
    label: "Cód.",
    tooltip: "Código do Colaborador no ERP.",
    value: (r) => r.codigoColaborador,
    sortable: true,
    searchable: true,
    mobileRole: "secondary",
    cellClassName: "font-mono text-xs w-20",
  },
  {
    key: "nome",
    label: "Colaborador",
    value: (r) => r.nome,
    sortable: true,
    searchable: true,
    mobileRole: "primary",
    cellClassName: "font-medium",
  },
];

/** Página Colaboradores: lista os Colaboradores do ERP, somente para leitura. */
export function ColaboradoresPage() {
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [situacao, setSituacao] = useState<Situacao>("ativos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<ListaColaboradores>("/api/m/inovafarma/colaboradores");
      setColaboradores(data.colaboradores);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro desconhecido ao carregar os Colaboradores.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const rows = useMemo(
    () => (situacao === "ativos" ? colaboradores.filter((c) => c.ativo) : colaboradores),
    [colaboradores, situacao],
  );

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Falha ao carregar os Colaboradores:</AlertTitle>
        <AlertDescription>
          <Stack gap="group" align="start">
            {error}
            <Button variant="outline" onClick={() => void carregar()}>
              Tentar novamente
            </Button>
          </Stack>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Stack gap="section">
      <Stack direction="row" wrap align="end" gap="section" surface="card">
        <Stack gap="field" grow narrow>
          <Label htmlFor="colaboradores-situacao">Situação</Label>
          <Select value={situacao} onValueChange={(val) => val && setSituacao(val as Situacao)}>
            <SelectTrigger id="colaboradores-situacao">
              <SelectValue>{SITUACAO_LABEL[situacao]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ativos">{SITUACAO_LABEL.ativos}</SelectItem>
              <SelectItem value="todos">{SITUACAO_LABEL.todos}</SelectItem>
            </SelectContent>
          </Select>
        </Stack>
      </Stack>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => String(r.codigoColaborador)}
        loading={loading}
        title="Colaboradores"
        emptyMessage="Nenhum Colaborador encontrado."
        pagination={{ pageSize: 20 }}
        striped
        bordered
      />
    </Stack>
  );
}
