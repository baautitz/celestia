import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import { Button } from "@platform/ui/components/button";
import { Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList, ComboboxValue, useComboboxAnchor } from "@platform/ui/components/combobox";
import { FieldGroup } from "@platform/ui/components/field";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { Input } from "@platform/ui/components/input";
import { Label } from "@platform/ui/components/label";
import { Stack, Text } from "@platform/ui/components/layout";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { MEDIDA_LABEL, MEDIDAS_COLUNA, MEDIDAS_PADRAO, descreverColuna, type ColunaDesempenho, type DadosColunaDesempenho, type MedidaColuna } from "./colunas-desempenho";
import { ListaProdutosCampo } from "./lista-produtos-campo";
import type { EntradaLista } from "./tipos-meta";
import { API, json } from "./inovafarma-api";

const BASE = `${API}/colunas-desempenho`;

const schema = z.object({ nome: z.string().trim().min(1, "Informe o nome da coluna.").max(40, "O nome deve ter no máximo 40 caracteres.") });
type Valores = z.input<typeof schema>;

interface FormProps {
  /** Presente na edição. */
  coluna?: ColunaDesempenho;
  /** As outras colunas: só as que não são união servem de parte de uma união. */
  outras: ColunaDesempenho[];
}

/** Janela de uma coluna do Desempenho de Vendas (criar ou editar): o nome, as entradas que soma e a união com outras colunas. */
export function ColunaDesempenhoWindow({ coluna, outras }: FormProps) {
  const { resolve } = useWindow<ColunaDesempenho>();
  const { feedback } = useUi();
  const [entradas, setEntradas] = useState<EntradaLista[]>(coluna?.entradas ?? []);
  const [uniao, setUniao] = useState<string[]>(coluna?.uniao ?? []);
  const [medidas, setMedidas] = useState<MedidaColuna[]>(coluna?.medidas ?? MEDIDAS_PADRAO);
  const [erro, setErro] = useState<string | null>(null);
  const form = useForm<Valores>({ resolver: zodResolver(schema), defaultValues: { nome: coluna?.nome ?? "" } });
  const candidatas = outras.filter((o) => o.uniao.length === 0);

  const ancora = useComboboxAnchor();
  const ancoraMedidas = useComboboxAnchor();

  const onSubmit = async ({ nome }: Valores) => {
    if (medidas.length === 0) {
      setErro("Escolha pelo menos uma medida.");
      return;
    }
    if (entradas.length === 0 && uniao.length === 0) {
      setErro("Adicione pelo menos uma entrada ou una outra coluna.");
      return;
    }
    setErro(null);
    const dados: DadosColunaDesempenho = { nome: nome.trim(), entradas, uniao, medidas: MEDIDAS_COLUNA.filter((m) => medidas.includes(m)) };
    try {
      const salva = coluna
        ? await apiFetch<ColunaDesempenho>(`${BASE}/${coluna.id}`, json("PUT", { ...dados, version: coluna.version }))
        : await apiFetch<ColunaDesempenho>(BASE, json("POST", dados));
      feedback.notify({ type: "success", title: coluna ? "Coluna alterada." : "Coluna criada." });
      resolve(salva);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao salvar a coluna."));
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="coluna-desempenho-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <FormField
              control={form.control}
              name="nome"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome da coluna</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Ex.: Vitaminas" autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Stack gap="field">
              <Label htmlFor="coluna-desempenho-medidas">O que mostrar</Label>
              <Text variant="small" tone="muted">
                As medidas que a coluna traz na tabela e no cartão: unidades, valor vendido, participação, CMV e ticket.
              </Text>
              <Combobox
                multiple
                autoHighlight
                items={[...MEDIDAS_COLUNA]}
                value={MEDIDAS_COLUNA.filter((m) => medidas.includes(m))}
                onValueChange={(escolhidas: MedidaColuna[]) => setMedidas(escolhidas)}
                itemToStringLabel={(m: MedidaColuna) => MEDIDA_LABEL[m]}
              >
                <ComboboxChips ref={ancoraMedidas}>
                  <ComboboxValue>
                    {(escolhidas: MedidaColuna[]) => (
                      <>
                        {escolhidas.map((m) => (
                          <ComboboxChip key={m}>{MEDIDA_LABEL[m]}</ComboboxChip>
                        ))}
                        <ComboboxChipsInput id="coluna-desempenho-medidas" placeholder={escolhidas.length === 0 ? "Escolha as medidas" : ""} />
                      </>
                    )}
                  </ComboboxValue>
                </ComboboxChips>
                <ComboboxContent anchor={ancoraMedidas}>
                  <ComboboxEmpty>Nenhuma medida encontrada.</ComboboxEmpty>
                  <ComboboxList>
                    {(m: MedidaColuna) => (
                      <ComboboxItem key={m} value={m}>
                        {MEDIDA_LABEL[m]}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </Stack>
            <ListaProdutosCampo entradas={entradas} onChange={setEntradas} erro={erro} />
            {candidatas.length > 0 && (
              <Stack gap="field">
                <Label htmlFor="coluna-desempenho-uniao">Somar também as colunas</Label>
                <Text variant="small" tone="muted">
                  Une às entradas desta coluna as entradas das colunas escolhidas. Um produto que está em mais de uma conta uma vez.
                </Text>
                <Combobox
                  multiple
                  autoHighlight
                  items={candidatas}
                  value={candidatas.filter((c) => uniao.includes(c.id))}
                  onValueChange={(escolhidas: ColunaDesempenho[]) => setUniao(escolhidas.map((c) => c.id))}
                  itemToStringLabel={(c: ColunaDesempenho) => c.nome}
                  itemToStringValue={(c: ColunaDesempenho) => c.id}
                  isItemEqualToValue={(a: ColunaDesempenho, b: ColunaDesempenho) => a.id === b.id}
                >
                  <ComboboxChips ref={ancora}>
                    <ComboboxValue>
                      {(escolhidas: ColunaDesempenho[]) => (
                        <>
                          {escolhidas.map((c) => (
                            <ComboboxChip key={c.id}>{c.nome}</ComboboxChip>
                          ))}
                          <ComboboxChipsInput id="coluna-desempenho-uniao" placeholder={escolhidas.length === 0 ? "Buscar coluna" : ""} />
                        </>
                      )}
                    </ComboboxValue>
                  </ComboboxChips>
                  <ComboboxContent anchor={ancora}>
                    <ComboboxEmpty>Nenhuma coluna encontrada.</ComboboxEmpty>
                    <ComboboxList>
                      {(c: ColunaDesempenho) => (
                        <ComboboxItem key={c.id} value={c}>
                          {c.nome}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </Stack>
            )}
          </FieldGroup>
        </form>
      </Form>
      <WindowActions>
        <WindowCancelButton />
        <Button type="submit" form="coluna-desempenho-form">
          Salvar
        </Button>
      </WindowActions>
    </>
  );
}

/** Abre a janela de uma coluna; resolve true quando ela foi salva. */
export async function abrirColuna(windows: ReturnType<typeof useUi>["windows"], todas: ColunaDesempenho[], coluna?: ColunaDesempenho): Promise<boolean> {
  const resultado = await windows.open<ColunaDesempenho>({
    surface: "dialog",
    size: "full",
    title: coluna ? "Alterar coluna" : "Adicionar coluna",
    description: "O que a coluna soma no Desempenho de Vendas: Produtos, Grupos, Seções e Laboratórios. Cada produto vendido conta uma vez.",
    content: () => <ColunaDesempenhoWindow coluna={coluna} outras={todas.filter((c) => c.id !== coluna?.id)} />,
  });
  return resultado.status === "confirmed";
}

/** Janela "Colunas": lista as colunas do cliente, com adicionar, alterar e remover. */
export function ColunasDesempenhoWindow() {
  const { windows, feedback } = useUi();
  const [colunas, setColunas] = useState<ColunaDesempenho[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    try {
      setColunas(await apiFetch<ColunaDesempenho[]>(BASE));
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar as colunas."));
    } finally {
      setCarregando(false);
    }
  }, [feedback]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const abrir = async (coluna?: ColunaDesempenho) => {
    await abrirColuna(windows, colunas, coluna);
    void carregar();
  };

  const remover = async (coluna: ColunaDesempenho) => {
    const ok = await windows.confirm({ title: "Remover coluna", description: `Remover a coluna "${coluna.nome}" do Desempenho de Vendas?`, confirmLabel: "Remover", destructive: true });
    if (!ok) return;
    try {
      await apiFetch(`${BASE}/${coluna.id}?version=${coluna.version}`, { method: "DELETE" });
      feedback.notify({ type: "success", title: "Coluna removida." });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao remover a coluna."));
    }
    void carregar();
  };

  const tabela: DataTableColumn<ColunaDesempenho>[] = [
    { key: "nome", label: "Coluna", value: (c) => c.nome, searchable: true, mobileRole: "primary" },
    { key: "conteudo", label: "Soma", value: (c) => descreverColuna(c, colunas), cellClassName: "min-w-64 whitespace-normal" },
  ];

  return (
    <Stack gap="section">
      <Stack direction="row" justify="end">
        <Button onClick={() => void abrir()}>
          <Plus />
          Adicionar coluna
        </Button>
      </Stack>
      <DataTable
        columns={tabela}
        rows={colunas}
        getRowId={(c) => c.id}
        loading={carregando}
        emptyMessage="Nenhuma coluna cadastrada."
        rowActions={(c) => (
          <Stack direction="row" gap="tight">
            <Button size="icon" variant="ghost" aria-label={`Alterar a coluna ${c.nome}`} onClick={() => void abrir(c)}>
              <Pencil />
            </Button>
            <Button size="icon" variant="ghost" tone="destructive" aria-label={`Remover a coluna ${c.nome}`} onClick={() => void remover(c)}>
              <Trash2 />
            </Button>
          </Stack>
        )}
      />
    </Stack>
  );
}
