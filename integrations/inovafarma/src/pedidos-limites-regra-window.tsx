import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { Trash2 } from "lucide-react";
import { Button } from "@platform/ui/components/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@platform/ui/components/combobox";
import { FieldGroup } from "@platform/ui/components/field";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { Input } from "@platform/ui/components/input";
import { Label } from "@platform/ui/components/label";
import { Stack, Text } from "@platform/ui/components/layout";
import { DataTable } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { json } from "./inovafarma-api";
import { ListaProdutosCampo } from "./lista-produtos-campo";
import { LIMITES_BASE, nomeDoFornecedor, type Fornecedor } from "./pedidos-limites-comum";
import { DadosRegraLimite, type RegraLimite } from "./pedidos-limites";

/** Janela de criar ou editar a Regra de Limite. */
export function RegraLimiteWindow({ regra, fornecedores }: { regra?: RegraLimite; fornecedores: Fornecedor[] }) {
  const { resolve } = useWindow<RegraLimite>();
  const { feedback } = useUi();
  const form = useForm<DadosRegraLimite>({
    resolver: zodResolver(DadosRegraLimite),
    defaultValues: { nome: regra?.nome ?? "", entradas: regra?.entradas ?? [], fornecedores: regra?.fornecedores ?? [] },
  });
  const entradas = useWatch({ control: form.control, name: "entradas" });
  const escolhidos = useWatch({ control: form.control, name: "fornecedores" });
  const escolher = (codigos: number[]) => form.setValue("fornecedores", codigos, { shouldDirty: true });

  const salvar = async (dados: DadosRegraLimite) => {
    try {
      const salva = regra
        ? await apiFetch<RegraLimite>(`${LIMITES_BASE}/regras/${regra.id}`, json("PUT", { ...dados, version: regra.version }))
        : await apiFetch<RegraLimite>(`${LIMITES_BASE}/regras`, json("POST", dados));
      feedback.notify({ type: "success", title: regra ? "Regra de Limite alterada." : "Regra de Limite criada." });
      resolve(salva);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao salvar a Regra."));
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="regra-limite-form" noValidate onSubmit={form.handleSubmit(salvar)}>
          <FieldGroup>
            <FormField
              control={form.control}
              name="nome"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input autoFocus maxLength={80} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <ListaProdutosCampo
              entradas={entradas}
              base={`${LIMITES_BASE}/lista`}
              descricao="Os Produtos, Grupos, Seções e Laboratórios que o Limite controla. Cada produto conta uma vez."
              erro={form.formState.errors.entradas?.message}
              onChange={(novas) => form.setValue("entradas", novas, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })}
            />
            <Stack gap="field">
              <Label htmlFor="regra-limite-distribuidora">Distribuidoras</Label>
              <Combobox
                autoHighlight
                items={fornecedores.filter((f) => !escolhidos.includes(f.codigo))}
                value={null}
                onValueChange={(f: Fornecedor | null) => f && escolher([...escolhidos, f.codigo])}
                itemToStringLabel={(f: Fornecedor) => f.nome}
                itemToStringValue={(f: Fornecedor) => String(f.codigo)}
              >
                <ComboboxInput id="regra-limite-distribuidora" showTrigger={false} placeholder="Buscar distribuidora" />
                <ComboboxContent>
                  <ComboboxEmpty>Nenhuma distribuidora encontrada.</ComboboxEmpty>
                  <ComboboxList>
                    {(f: Fornecedor) => (
                      <ComboboxItem key={f.codigo} value={f}>
                        {f.nome}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              {escolhidos.length === 0 ? (
                <Text variant="small" tone="muted">
                  Nenhuma escolhida: vale para todas as distribuidoras.
                </Text>
              ) : (
                <DataTable
                  columns={[{ key: "nome", label: "Distribuidora", value: (c: number) => nomeDoFornecedor(fornecedores, c), mobileRole: "primary" }]}
                  rows={escolhidos}
                  getRowId={String}
                  rowActions={(c) => (
                    <Button type="button" size="icon" variant="outline" aria-label={`Remover ${nomeDoFornecedor(fornecedores, c)}`} onClick={() => escolher(escolhidos.filter((x) => x !== c))}>
                      <Trash2 />
                    </Button>
                  )}
                />
              )}
            </Stack>
          </FieldGroup>
        </form>
      </Form>
      <WindowActions>
        <WindowCancelButton />
        <Button type="submit" form="regra-limite-form" disabled={form.formState.isSubmitting}>
          {regra ? "Salvar" : "Criar"}
        </Button>
      </WindowActions>
    </>
  );
}
