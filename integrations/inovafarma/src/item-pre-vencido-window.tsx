import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@platform/ui/components/button";
import { FieldGroup } from "@platform/ui/components/field";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { Input } from "@platform/ui/components/input";
import { MonthPicker } from "@platform/ui/components/month-picker";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { ProdutoBusca } from "./produto-busca";

const BASE = "/api/m/inovafarma/pre-vencidos";

/** Item de Pré-vencido como a API devolve: nunca o código do produto no ERP. */
export interface ItemPreVencido {
  id: string;
  codigoLoja: number;
  produtoId: string;
  nomeProduto: string;
  codigoBarra: string | null;
  validade: string;
  quantidade: number;
  /** O que sobra do Item depois das Baixas. */
  restante: number;
  incluidoEm: string;
  version: number;
}

const schema = z.object({
  produtoId: z.string().min(1, "Busque e selecione o produto."),
  quantidade: z.string().regex(/^[1-9]\d{0,6}$/, "Informe uma quantidade inteira maior que zero."),
  validade: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Informe a validade (mês e ano)."),
});
type Valores = z.infer<typeof schema>;

interface Props {
  codigoLoja: number;
  /** Presente na edição: só quantidade e validade mudam. */
  item?: ItemPreVencido;
}

/** Janela de Item de Pré-vencido (incluir ou editar) no Estoque de uma Loja; resolve com o Item salvo. */
export function ItemPreVencidoWindow({ codigoLoja, item }: Props) {
  const { resolve } = useWindow<ItemPreVencido>();
  const { feedback } = useUi();
  const form = useForm<Valores>({
    resolver: zodResolver(schema),
    defaultValues: { produtoId: item?.produtoId ?? "", quantidade: item ? String(item.quantidade) : "", validade: item?.validade ?? "" },
  });

  const onSubmit = async (valores: Valores) => {
    const corpo = { quantidade: Number(valores.quantidade), validade: valores.validade };
    try {
      const salvo = item
        ? await apiFetch<ItemPreVencido>(`${BASE}/estoque/itens/${item.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...corpo, version: item.version }),
          })
        : await apiFetch<ItemPreVencido>(`${BASE}/estoque/itens`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ codigoLoja, produtoId: valores.produtoId, ...corpo }),
          });
      feedback.notify({ type: "success", title: item ? "Item alterado." : "Item incluído." });
      resolve(salvo);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao salvar o Item."));
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="item-pre-vencido-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            {/* Na edição o produto não muda; o nome já aparece na descrição da janela. */}
            {!item && (
              <FormField
                control={form.control}
                name="produtoId"
                render={() => (
                  <FormItem>
                    <ProdutoBusca
                      id="item-pre-vencido-busca"
                      url={`${BASE}/produtos`}
                      onChange={(p) => form.setValue("produtoId", p?.id ?? "", { shouldValidate: form.formState.isSubmitted })}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="quantidade"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantidade</FormLabel>
                  <FormControl>
                    <Input type="number" inputMode="numeric" min={1} step={1} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="validade"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Validade</FormLabel>
                  <FormControl>
                    <MonthPicker value={field.value || undefined} onChange={(mes) => field.onChange(mes ?? "")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FieldGroup>
        </form>
      </Form>
      <WindowActions>
        <WindowCancelButton />
        <Button type="submit" form="item-pre-vencido-form" disabled={form.formState.isSubmitting}>
          {item ? "Salvar" : "Incluir"}
        </Button>
      </WindowActions>
    </>
  );
}
