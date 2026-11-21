import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { FieldGroup } from "@platform/ui/components/field";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { Input } from "@platform/ui/components/input";
import { Stack } from "@platform/ui/components/layout";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { API, json } from "./inovafarma-api";
import { ListaProdutosCampo } from "./lista-produtos-campo";
import { descreverLista, listaPronta, type ListaPedidos } from "./pedidos-listas";
import type { EntradaLista } from "./tipos-meta";

const BASE = `${API}/pedidos/listas`;

const schema = z.object({ nome: z.string().trim().min(1, "Informe o nome da lista.").max(60, "O nome deve ter no máximo 60 caracteres.") });
type Valores = z.input<typeof schema>;

/** Janela de uma lista de produtos de Pedidos (criar ou editar): o nome e as entradas. */
function ListaPedidosWindow({ lista }: { lista?: ListaPedidos }) {
  const { resolve } = useWindow<ListaPedidos>();
  const { feedback } = useUi();
  const [entradas, setEntradas] = useState<EntradaLista[]>(lista?.entradas ?? []);
  const form = useForm<Valores>({ resolver: zodResolver(schema), defaultValues: { nome: lista?.nome ?? "" } });

  const onSubmit = async ({ nome }: Valores) => {
    const dados = { nome: nome.trim(), entradas };
    try {
      const salva = lista ? await apiFetch<ListaPedidos>(`${BASE}/${lista.id}`, json("PUT", { ...dados, version: lista.version })) : await apiFetch<ListaPedidos>(BASE, json("POST", dados));
      feedback.notify({ type: "success", title: lista ? "Lista alterada." : "Lista criada." });
      resolve(salva);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao salvar a lista."));
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="pedidos-lista-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <FormField
              control={form.control}
              name="nome"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome da lista</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Ex.: Vitaminas" autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <ListaProdutosCampo entradas={entradas} onChange={setEntradas} />
          </FieldGroup>
        </form>
      </Form>
      <WindowActions>
        <WindowCancelButton />
        <Button type="submit" form="pedidos-lista-form">
          Salvar
        </Button>
      </WindowActions>
    </>
  );
}

/** Aba Listas: as listas de produtos de Pedidos, com adicionar, alterar e excluir. */
export function PedidosListasTab() {
  const { windows, feedback } = useUi();
  const [listas, setListas] = useState<ListaPedidos[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    try {
      setListas(await apiFetch<ListaPedidos[]>(BASE));
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar as listas."));
    } finally {
      setCarregando(false);
    }
  }, [feedback]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const abrir = async (lista?: ListaPedidos) => {
    await windows.open<ListaPedidos>({
      surface: "dialog",
      size: "full",
      title: lista ? "Alterar lista" : "Adicionar lista",
      description: "Os Produtos, Grupos, Seções e Laboratórios da lista. No Lançamento, várias listas se unem.",
      content: () => <ListaPedidosWindow lista={lista} />,
    });
    void carregar();
  };

  const remover = async (lista: ListaPedidos) => {
    const ok = await windows.confirm({ title: "Excluir lista", description: `Excluir a lista "${lista.nome}"?`, confirmLabel: "Excluir", destructive: true });
    if (!ok) return;
    try {
      await apiFetch(`${BASE}/${lista.id}?version=${lista.version}`, { method: "DELETE" });
      feedback.notify({ type: "success", title: "Lista excluída." });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao excluir a lista."));
    }
    void carregar();
  };

  const colunas: DataTableColumn<ListaPedidos>[] = [
    { key: "nome", label: "Lista", value: (l) => l.nome, searchable: true, mobileRole: "primary" },
    { key: "situacao", label: "Situação", render: (l) => (listaPronta(l) ? <Badge variant="success">Pronta</Badge> : <Badge variant="warning">Em montagem</Badge>), value: (l) => (listaPronta(l) ? "Pronta" : "Em montagem") },
    { key: "conteudo", label: "Conteúdo", value: (l) => descreverLista(l), cellClassName: "min-w-64 whitespace-normal" },
  ];

  return (
    <Stack gap="section">
      <Stack direction="row" justify="end">
        <Button onClick={() => void abrir()}>
          <Plus />
          Adicionar lista
        </Button>
      </Stack>
      <DataTable
        title="Listas de produtos"
        columns={colunas}
        rows={listas}
        getRowId={(l) => l.id}
        loading={carregando}
        emptyMessage="Nenhuma lista cadastrada."
        rowActions={(l) => (
          <Stack direction="row" gap="tight">
            <Button size="icon" variant="ghost" aria-label={`Alterar a lista ${l.nome}`} onClick={() => void abrir(l)}>
              <Pencil />
            </Button>
            <Button size="icon" variant="ghost" tone="destructive" aria-label={`Excluir a lista ${l.nome}`} onClick={() => void remover(l)}>
              <Trash2 />
            </Button>
          </Stack>
        )}
      />
    </Stack>
  );
}
