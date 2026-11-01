import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, UserPlus } from "lucide-react";
import { avisarVinculoAlterado } from "./colaboradores-badge";
import { sugerirUsername } from "./username-sugerido";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Badge } from "@platform/ui/components/badge";
import { Button, MultiValueButton } from "@platform/ui/components/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@platform/ui/components/combobox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@platform/ui/components/dropdown-menu";
import { Label } from "@platform/ui/components/label";
import { Stack } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useLeaveGuard } from "@platform/ui/adapters/leave-guard";
import { HeaderActions } from "@platform/ui/context/header-actions";
import { useWebService } from "@platform/ui/contracts/web-services";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch, ApiError } from "@platform/ui/lib/api";

interface UsuarioOpcao {
  id: string;
  fullname: string;
  username: string;
}

/** Forma do serviço `iam:users` do módulo web IAM; o Plugin não importa `@platform/web`. */
interface UsuariosWebService {
  openCreate(windows: ReturnType<typeof useUi>["windows"], options: { fullname?: string; suggestUsername?: (fullname: string) => string }): Promise<UsuarioOpcao | null>;
}

interface LojaOpcao {
  codigo: number;
  nome: string;
}

interface Aviso {
  tipo: "usuario_desativado" | "inativo_no_erp" | "loja_nao_encontrada" | "colaborador_nao_encontrado";
  mensagem: string;
}

interface CamposVinculo {
  confirmado: boolean;
  usuarioId: string | null;
  usuario: (UsuarioOpcao & { status: string }) | null;
  lojas: number[];
  version: number;
  avisos: Aviso[];
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
  podeCriarUsuario: boolean;
  lojas: LojaOpcao[];
}

/** Valores editáveis de uma linha: os gravados ou o rascunho ainda não salvo. */
type Valores = Pick<CamposVinculo, "usuarioId" | "lojas">;

/** A `version` é a de quando a edição começou: recarregar a lista não pode esconder um conflito. */
type Rascunho = Valores & Pick<CamposVinculo, "version">;

const iniciais = ({ usuarioId, lojas, sugestao }: CamposVinculo): Valores => sugestao ?? { usuarioId, lojas };
const mesmasLojas = (a: number[], b: number[]) => a.length === b.length && a.every((codigo) => b.includes(codigo));
const mudou = (a: Valores, b: Valores) => a.usuarioId !== b.usuarioId || !mesmasLojas(a.lojas, b.lojas);

const naoEncontrado = (c: CamposVinculo) => c.avisos.some((a) => a.tipo === "colaborador_nao_encontrado");

function SeloSugestao() {
  return <Badge variant="info">Sugestão</Badge>;
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
  const items = useMemo(() => {
    const foraDoErp = row.lojas.filter((codigo) => !opcoes.some((o) => o.codigo === codigo)).map((codigo) => ({ codigo, nome: `Loja não encontrada (cód. ${codigo})` }));
    return [...foraDoErp, ...opcoes];
  }, [row.lojas, opcoes]);
  const selecionadas = items.filter((o) => lojas.includes(o.codigo));
  const alternar = (codigo: number, marcada: boolean) =>
    onChange((marcada ? [...lojas, codigo] : lojas.filter((l) => l !== codigo)).sort((a, b) => a - b));

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <MultiValueButton aria-label={`Lojas de ${row.nome}`} values={selecionadas.map((o) => o.nome)} placeholder="Selecione as Lojas" />
        }
      />
      <DropdownMenuContent>
        {items.map((o) => (
          <DropdownMenuCheckboxItem key={o.codigo} closeOnClick={false} checked={lojas.includes(o.codigo)} onCheckedChange={(marcada) => alternar(o.codigo, marcada)}>
            {o.nome}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Página Colaboradores: lista os Colaboradores do ERP e grava de uma vez os vínculos editados. */
export function ColaboradoresPage() {
  const { feedback, windows } = useUi();
  const usuariosIam = useWebService<UsuariosWebService>("iam", "users");
  const [podeCriarUsuario, setPodeCriarUsuario] = useState(false);
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioOpcao[]>([]);
  const [lojas, setLojas] = useState<LojaOpcao[]>([]);
  // Edições ainda não gravadas, por Colaborador; ficam aqui porque a célula desmonta ao trocar de página.
  const [edicoes, setEdicoes] = useState<Record<number, Rascunho>>({});
  const [salvando, setSalvando] = useState<ReadonlySet<number>>(new Set());
  // Motivo da última falha ao gravar, por Colaborador; some quando a linha é editada de novo ou gravada.
  const [falhas, setFalhas] = useState<Record<number, string>>({});
  const [situacao, setSituacao] = useState<Situacao>("ativos");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    try {
      const data = await apiFetch<ListaColaboradores>("/api/m/inovafarma/colaboradores");
      setColaboradores(data.colaboradores);
      setUsuarios(data.usuarios);
      setPodeCriarUsuario(data.podeCriarUsuario);
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

  const limparFalha = useCallback((codigo: number) => {
    setFalhas(({ [codigo]: _limpa, ...resto }) => resto);
  }, []);

  /** Grava uma linha; devolve o erro em vez de avisar, para o resumo ser um só. */
  const gravar = useCallback(
    async (row: Colaborador, rascunho: Rascunho): Promise<Error | null> => {
      const codigo = row.codigoColaborador;
      setSalvando((atual) => new Set(atual).add(codigo));
      try {
        const salvo = await apiFetch<CamposVinculo>(`/api/m/inovafarma/colaboradores/${codigo}/vinculo`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usuarioId: rascunho.usuarioId, lojas: rascunho.lojas, version: rascunho.version }),
        });
        // Sem o vínculo, quem sumiu do ERP não tem mais por que ser linha da tabela.
        setColaboradores((atual) =>
          naoEncontrado(row) && !salvo.confirmado ? atual.filter((c) => c.codigoColaborador !== codigo) : atual.map((c) => (c.codigoColaborador === codigo ? { ...c, ...salvo } : c)),
        );
        descartarEdicao(codigo);
        return null;
      } catch (err: unknown) {
        return err instanceof Error ? err : new Error("Erro desconhecido ao salvar o vínculo.");
      } finally {
        setSalvando((atual) => {
          const proximo = new Set(atual);
          proximo.delete(codigo);
          return proximo;
        });
      }
    },
    [descartarEdicao],
  );

  // Só o que foi editado e difere do gravado; sem o Colaborador no ERP só se pode desfazer o vínculo.
  const { pendentes, bloqueados } = useMemo(() => {
    const alterados = colaboradores.flatMap((c) => {
      const edicao = edicoes[c.codigoColaborador];
      return edicao !== undefined && mudou(edicao, c) ? [{ row: c, edicao }] : [];
    });
    const estaBloqueado = ({ row, edicao }: { row: Colaborador; edicao: Rascunho }) =>
      naoEncontrado(row) && (edicao.usuarioId !== null || edicao.lojas.length > 0);
    return { pendentes: alterados.filter((a) => !estaBloqueado(a)), bloqueados: alterados.filter(estaBloqueado) };
  }, [colaboradores, edicoes]);

  const [salvandoTudo, setSalvandoTudo] = useState(false);

  const salvarTudo = useCallback(async () => {
    setSalvandoTudo(true);
    setFalhas({});
    const erros: { row: Colaborador; erro: Error }[] = [];
    // Uma a uma e na ordem da tabela, mas quem libera um Usuário vai antes: mover um Usuário de um Colaborador para outro
    // só funciona gravando primeiro quem o larga. Dois Colaboradores com o mesmo Usuário seguem falhando de forma previsível.
    const libera = ({ row, edicao }: { row: Colaborador; edicao: Rascunho }) => row.usuarioId !== null && edicao.usuarioId !== row.usuarioId;
    const emOrdem = [...pendentes].sort((a, b) => Number(libera(b)) - Number(libera(a)));
    for (const { row, edicao } of emOrdem) {
      const erro = await gravar(row, edicao);
      if (erro) erros.push({ row, erro });
    }
    const salvos = pendentes.length - erros.length;
    if (salvos > 0) avisarVinculoAlterado();
    const desatualizados = erros.filter(({ erro }) => erro instanceof ApiError && erro.code === "versao_desatualizada");
    // Revalida a lista com o servidor depois de gravar, deu certo ou não: status, avisos e sugestões das demais linhas
    // dependem do que foi gravado. O rascunho de quem falhou fica (com a `version` de quando a edição começou).
    await buscar();
    desatualizados.forEach(({ row }) => descartarEdicao(row.codigoColaborador));
    setFalhas(Object.fromEntries(erros.filter((e) => !desatualizados.includes(e)).map(({ row, erro }) => [row.codigoColaborador, erro.message])));
    const pulados = bloqueados.length > 0 ? ` ${bloqueados.length} sem o Colaborador no ERP só aceitam desfazer o vínculo e não foram gravados.` : "";
    if (erros.length === 0) {
      feedback.notify({ type: bloqueados.length > 0 ? "warning" : "success", title: `${salvos} ${salvos === 1 ? "vínculo salvo" : "vínculos salvos"}`, description: pulados.trim() || undefined });
    } else {
      feedback.notify({
        type: "warning",
        title: `${salvos} salvos, ${erros.length} não salvos`,
        description: `${erros.map(({ row, erro }) => `${row.nome}: ${erro.message}`).join("\n")}${pulados}`,
      });
    }
    setSalvandoTudo(false);
  }, [pendentes, bloqueados, gravar, buscar, descartarEdicao, feedback]);

  const opcoes = useMemo(() => usuarios.map(paraOpcao), [usuarios]);

  const columns = useMemo<DataTableColumn<Colaborador>[]>(() => {
    const novoRascunho = (r: Colaborador): Rascunho => ({ ...iniciais(r), version: r.version });
    const valoresDe = (r: Colaborador): Rascunho => edicoes[r.codigoColaborador] ?? novoRascunho(r);
    const editar = (r: Colaborador, alteracao: Partial<Valores>) => {
      // Uma linha em gravação não aceita edição: ao terminar, o rascunho seria descartado.
      if (salvando.has(r.codigoColaborador)) return;
      limparFalha(r.codigoColaborador);
      setEdicoes((atual) => ({ ...atual, [r.codigoColaborador]: { ...(atual[r.codigoColaborador] ?? novoRascunho(r)), ...alteracao } }));
    };
    // O Usuário criado entra só como rascunho: o vínculo continua dependendo de confirmar a linha.
    const criarUsuario = async (r: Colaborador) => {
      try {
        // O mesmo cadastro da tela Usuários, oferecido pelo módulo IAM.
        const usuario = await usuariosIam.openCreate(windows, { fullname: r.nome, suggestUsername: sugerirUsername });
        if (!usuario) return;
        const criado = { id: usuario.id, fullname: usuario.fullname, username: usuario.username };
        setUsuarios((atual) => [...atual, criado].sort((a, b) => a.fullname.localeCompare(b.fullname, "pt-BR")));
        editar(r, { usuarioId: criado.id });
      } catch (err: unknown) {
        feedback.notifyError(err instanceof Error ? err : new Error("Erro ao criar o Usuário."));
      }
    };
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
        mobileWide: true,
        label: "Usuário",
        // A busca e a ordenação seguem o Usuário exibido na linha, inclusive o rascunho ainda não confirmado.
        value: (r) => {
          const { usuarioId } = valoresDe(r);
          return opcoes.find((o) => o.value === usuarioId)?.label ?? opcaoGravada(r)?.label ?? "";
        },
        sortable: true,
        searchable: true,
        render: (r) => {
          const { usuarioId } = valoresDe(r);
          return (
            <Stack direction="row" gap="field" align="center">
              <UsuarioSelect row={r} opcoes={opcoes} usuarioId={usuarioId} onChange={(novo) => editar(r, { usuarioId: novo })} />
              {usuarioId !== null && usuarioId === r.sugestao?.usuarioId && <SeloSugestao />}
              {podeCriarUsuario && usuarioId === null && !naoEncontrado(r) && (
                <Button variant="outline" size="icon" aria-label={`Criar Usuário para ${r.nome}`} onClick={() => void criarUsuario(r)}>
                  <UserPlus />
                </Button>
              )}
            </Stack>
          );
        },
      },
      {
        key: "lojas",
        mobileWide: true,
        label: "Lojas",
        render: (r) => {
          const valores = valoresDe(r).lojas;
          const sugeridas = r.sugestao?.lojas ?? [];
          return (
            <Stack direction="row" gap="field" align="center">
              <LojasSelect row={r} opcoes={lojas} lojas={valores} onChange={(selecionadas) => editar(r, { lojas: selecionadas })} />
              {sugeridas.length > 0 && mesmasLojas(valores, sugeridas) && <SeloSugestao />}
            </Stack>
          );
        },
      },
      {
        key: "status",
        label: "Status",
        render: (r) => (
          <Stack direction="row" wrap gap="field">
            <Badge variant={r.confirmado ? "success" : "warning"}>{r.confirmado ? "Confirmado" : "Pendente"}</Badge>
            {falhas[r.codigoColaborador] && (
              <Badge variant="destructive" title={falhas[r.codigoColaborador]}>
                Não salvo
              </Badge>
            )}
            {r.avisos.map((a) => (
              <Badge key={a.mensagem} variant="destructive">
                {a.mensagem}
              </Badge>
            ))}
          </Stack>
        ),
      },
    ];
  }, [edicoes, falhas, limparFalha, lojas, opcoes, salvando, podeCriarUsuario, windows, feedback, usuariosIam]);

  useLeaveGuard(
    colaboradores.some((c) => {
      // Comparar com os valores iniciais: uma sugestão não confirmada não é alteração pendente.
      const edicao = edicoes[c.codigoColaborador];
      return edicao !== undefined && mudou(edicao, iniciais(c));
    }),
  );

  const rows = useMemo(
    () =>
      colaboradores.filter(
        (c) => (situacao === "todos" || c.ativo || naoEncontrado(c)) && (filtroStatus === "todos" || c.confirmado === (filtroStatus === "confirmados")),
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
      <HeaderActions>
        <Button disabled={pendentes.length === 0 || salvandoTudo} onClick={() => void salvarTudo()}>
          {salvandoTudo ? "Salvando…" : `Salvar (${pendentes.length})`}
        </Button>
      </HeaderActions>
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
        search={{ placeholder: "Buscar por nome, código ou usuário..." }}
        emptyMessage="Nenhum Colaborador encontrado."
        striped
        bordered
      />
    </Stack>
  );
}
