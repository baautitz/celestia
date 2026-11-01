import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import {
  Combobox,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxChipsResumidos,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@platform/ui/components/combobox";
import { Label } from "@platform/ui/components/label";
import { Stack } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch, ApiError } from "@platform/ui/lib/api";

interface UsuarioOpcao {
  id: string;
  fullname: string;
  username: string;
}

interface LojaOpcao {
  codigo: number;
  nome: string;
}

interface CamposVinculo {
  confirmado: boolean;
  usuarioId: string | null;
  usuario: (UsuarioOpcao & { status: string }) | null;
  lojas: number[];
  version: number;
  sugestao: Pick<CamposVinculo, "usuarioId" | "lojas"> | null;
}

interface Colaborador extends CamposVinculo {
  codigoColaborador: number;
  nome: string;
  ativo: boolean;
}

interface ListaColaboradores {
  colaboradores: Colaborador[];
  usuarios: UsuarioOpcao[];
  lojas: LojaOpcao[];
}

/** Valores editáveis de uma linha: os gravados ou o rascunho ainda não salvo. */
type Valores = Pick<CamposVinculo, "usuarioId" | "lojas">;

const iniciais = ({ usuarioId, lojas, sugestao }: CamposVinculo): Valores => sugestao ?? { usuarioId, lojas };
const mesmasLojas = (a: number[], b: number[]) => a.length === b.length && a.every((codigo) => b.includes(codigo));

function SeloSugestao() {
  return <Badge variant="outline">Sugestão</Badge>;
}

type Situacao = "ativos" | "todos";

const SITUACAO_LABEL: Record<Situacao, string> = { ativos: "Ativos", todos: "Todos" };

type FiltroStatus = "todos" | "pendentes" | "confirmados";

const STATUS_LABEL: Record<FiltroStatus, string> = { todos: "Todos", pendentes: "Pendentes", confirmados: "Confirmados" };

interface OpcaoUsuario {
  value: string;
  label: string;
}

const paraOpcao = (u: UsuarioOpcao): OpcaoUsuario => ({ value: u.id, label: u.fullname });

/** Opções ativas e, se preciso, o Usuário já gravado: um desativado continua visível na própria linha. */
function opcaoGravada(row: Colaborador): OpcaoUsuario | null {
  if (row.usuarioId === null) return null;
  return row.usuario ? paraOpcao(row.usuario) : { value: row.usuarioId, label: "Usuário não encontrado" };
}

function UsuarioSelect({
  row,
  opcoes,
  usuarioId,
  onChange,
}: {
  row: Colaborador;
  opcoes: OpcaoUsuario[];
  usuarioId: string | null;
  onChange: (usuarioId: string | null) => void;
}) {
  const items = useMemo(() => {
    const gravada = opcaoGravada(row);
    return gravada && !opcoes.some((o) => o.value === gravada.value) ? [gravada, ...opcoes] : opcoes;
  }, [row, opcoes]);
  const value = items.find((o) => o.value === usuarioId) ?? null;

  return (
    <Combobox
      autoHighlight
      items={items}
      value={value}
      onValueChange={(item: OpcaoUsuario | null) => onChange(item?.value ?? null)}
      itemToStringLabel={(item: OpcaoUsuario) => item.label}
      itemToStringValue={(item: OpcaoUsuario) => item.value}
      isItemEqualToValue={(a: OpcaoUsuario, b: OpcaoUsuario) => a.value === b.value}
    >
      <ComboboxInput inTableCell aria-label={`Usuário de ${row.nome}`} placeholder="Selecione um Usuário" showClear={value !== null} clearLabel="Limpar Usuário" />
      <ComboboxContent>
        <ComboboxEmpty>Nenhum Usuário encontrado.</ComboboxEmpty>
        <ComboboxList>
          {(item: OpcaoUsuario) => (
            <ComboboxItem key={item.value} value={item}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function LojasSelect({
  row,
  opcoes,
  lojas,
  onChange,
}: {
  row: Colaborador;
  opcoes: LojaOpcao[];
  lojas: number[];
  onChange: (lojas: number[]) => void;
}) {
  const anchor = useComboboxAnchor();
  const items = useMemo(() => {
    const foraDoErp = row.lojas.filter((codigo) => !opcoes.some((o) => o.codigo === codigo)).map((codigo) => ({ codigo, nome: `Loja não encontrada (cód. ${codigo})` }));
    return [...foraDoErp, ...opcoes];
  }, [row.lojas, opcoes]);
  const value = useMemo(() => items.filter((o) => lojas.includes(o.codigo)), [items, lojas]);

  return (
    <Combobox
      multiple
      autoHighlight
      items={items}
      value={value}
      onValueChange={(selecionadas: LojaOpcao[]) => onChange(selecionadas.map((o) => o.codigo).sort((a, b) => a - b))}
      itemToStringLabel={(item: LojaOpcao) => item.nome}
      itemToStringValue={(item: LojaOpcao) => String(item.codigo)}
      isItemEqualToValue={(a: LojaOpcao, b: LojaOpcao) => a.codigo === b.codigo}
    >
      <ComboboxChips ref={anchor} inTableCell>
        <ComboboxValue>
          {(selecionadas: LojaOpcao[]) => (
            <ComboboxChipsResumidos labels={selecionadas.map((o) => o.nome)} removeLabel={(nome) => `Remover ${nome}`}>
              <ComboboxChipsInput aria-label={`Lojas de ${row.nome}`} placeholder={selecionadas.length === 0 ? "Selecione as Lojas" : undefined} />
            </ComboboxChipsResumidos>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>Nenhuma Loja encontrada.</ComboboxEmpty>
        <ComboboxList>
          {(item: LojaOpcao) => (
            <ComboboxItem key={item.codigo} value={item}>
              {item.nome}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/** Página Colaboradores: lista os Colaboradores do ERP e grava o vínculo de cada um na própria linha. */
export function ColaboradoresPage() {
  const { feedback } = useUi();
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioOpcao[]>([]);
  // Edições ainda não gravadas, por Colaborador; ficam aqui porque a célula desmonta ao trocar de página.
  const [lojas, setLojas] = useState<LojaOpcao[]>([]);
  const [edicoes, setEdicoes] = useState<Record<number, Valores>>({});
  const [salvando, setSalvando] = useState<ReadonlySet<number>>(new Set());
  const [situacao, setSituacao] = useState<Situacao>("ativos");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    try {
      const data = await apiFetch<ListaColaboradores>("/api/m/inovafarma/colaboradores");
      setColaboradores(data.colaboradores);
      setUsuarios(data.usuarios);
      setLojas(data.lojas);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro desconhecido ao carregar os Colaboradores.");
    }
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    setError(null);
    await buscar();
    setLoading(false);
  }, [buscar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const descartarEdicao = useCallback((codigo: number) => {
    setEdicoes(({ [codigo]: _descartada, ...resto }) => resto);
  }, []);

  const salvar = useCallback(
    async (row: Colaborador, valores: Valores) => {
      const codigo = row.codigoColaborador;
      setSalvando((atual) => new Set(atual).add(codigo));
      try {
        const salvo = await apiFetch<CamposVinculo>(`/api/m/inovafarma/colaboradores/${codigo}/vinculo`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usuarioId: valores.usuarioId, lojas: valores.lojas, version: row.version }),
        });
        setColaboradores((atual) => atual.map((c) => (c.codigoColaborador === codigo ? { ...c, ...salvo } : c)));
        descartarEdicao(codigo);
      } catch (err: unknown) {
        const mensagem = err instanceof Error ? err : new Error("Erro desconhecido ao salvar o vínculo.");
        if (err instanceof ApiError && err.status === 409) {
          feedback.notify({ title: "Vínculo não salvo", description: mensagem.message, type: "warning" });
          await buscar();
          descartarEdicao(codigo);
        } else {
          feedback.notifyError(mensagem, "Vínculo não salvo");
        }
      } finally {
        setSalvando((atual) => {
          const proximo = new Set(atual);
          proximo.delete(codigo);
          return proximo;
        });
      }
    },
    [buscar, descartarEdicao, feedback],
  );

  const opcoes = useMemo(() => usuarios.map(paraOpcao), [usuarios]);

  const columns = useMemo<DataTableColumn<Colaborador>[]>(() => {
    const valoresDe = (r: Colaborador): Valores => edicoes[r.codigoColaborador] ?? iniciais(r);
    const editar = (r: Colaborador, alteracao: Partial<Valores>) =>
      setEdicoes((atual) => ({ ...atual, [r.codigoColaborador]: { ...(atual[r.codigoColaborador] ?? iniciais(r)), ...alteracao } }));
    return [
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
      {
        key: "usuario",
        label: "Usuário",
        render: (r) => {
          const { usuarioId } = valoresDe(r);
          return (
            <Stack gap="field" align="start">
              <UsuarioSelect row={r} opcoes={opcoes} usuarioId={usuarioId} onChange={(novo) => editar(r, { usuarioId: novo })} />
              {usuarioId !== null && usuarioId === r.sugestao?.usuarioId && <SeloSugestao />}
            </Stack>
          );
        },
      },
      {
        key: "lojas",
        label: "Lojas",
        render: (r) => {
          const valores = valoresDe(r).lojas;
          const sugeridas = r.sugestao?.lojas ?? [];
          return (
            <Stack gap="field" align="start">
              <LojasSelect row={r} opcoes={lojas} lojas={valores} onChange={(selecionadas) => editar(r, { lojas: selecionadas })} />
              {sugeridas.length > 0 && mesmasLojas(valores, sugeridas) && <SeloSugestao />}
            </Stack>
          );
        },
      },
      {
        key: "status",
        label: "Status",
        render: (r) => <Badge variant={r.confirmado ? "default" : "outline"}>{r.confirmado ? "Confirmado" : "Pendente"}</Badge>,
      },
      {
        key: "acao",
        label: "Ação",
        render: (r) => {
          const valores = valoresDe(r);
          const alterado = valores.usuarioId !== r.usuarioId || !mesmasLojas(valores.lojas, r.lojas);
          return (
            <Button variant="outline" disabled={!alterado || salvando.has(r.codigoColaborador)} onClick={() => void salvar(r, valores)}>
              {r.confirmado ? "Salvar" : "Confirmar"}
            </Button>
          );
        },
      },
    ];
  }, [edicoes, lojas, opcoes, salvando, salvar]);

  const rows = useMemo(
    () =>
      colaboradores.filter(
        (c) => (situacao === "todos" || c.ativo) && (filtroStatus === "todos" || c.confirmado === (filtroStatus === "confirmados")),
      ),
    [colaboradores, situacao, filtroStatus],
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
        <Stack gap="field" grow narrow>
          <Label htmlFor="colaboradores-status">Status</Label>
          <Select value={filtroStatus} onValueChange={(val) => val && setFiltroStatus(val as FiltroStatus)}>
            <SelectTrigger id="colaboradores-status">
              <SelectValue>{STATUS_LABEL[filtroStatus]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{STATUS_LABEL.todos}</SelectItem>
              <SelectItem value="pendentes">{STATUS_LABEL.pendentes}</SelectItem>
              <SelectItem value="confirmados">{STATUS_LABEL.confirmados}</SelectItem>
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
