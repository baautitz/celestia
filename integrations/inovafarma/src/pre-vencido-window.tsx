import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@platform/ui/components/button";
import { FieldGroup } from "@platform/ui/components/field";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { Input } from "@platform/ui/components/input";
import { MonthPicker } from "@platform/ui/components/month-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { ProdutoBusca } from "./produto-busca";

const BASE = "/api/m/inovafarma/pre-vencidos";

export interface Lancamento {
  id: string;
  periodoId: string;
  codigoLoja: number;
  produtoId: string;
  nomeProduto: string;
  codigoBarra: string | null;
  quantidade: number;
  validade: string;
  version: number;
  nomeColaborador: string;
}

export interface LojaOpcao {
  codigo: number;
  nome: string;
}

const schema = z.object({
  codigoLoja: z.string().min(1, "Selecione a Loja."),
  produtoId: z.string().min(1, "Busque e selecione o produto."),
  quantidade: z.string().regex(/^[1-9]\d{0,6}$/, "Informe uma quantidade inteira maior que zero."),
  validade: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Informe a validade (mês e ano)."),
});
type Valores = z.infer<typeof schema>;

interface Props {
  periodoId: string;
  lojas: LojaOpcao[];
  /** Presente na edição: só quantidade e validade mudam. */
  lancamento?: Lancamento;
}

/** Janela de Lançamento de Pré-vencido (criar ou editar); resolve com o lançamento salvo. */
export function LancamentoWindow({ periodoId, lojas, lancamento }: Props) {
  const { resolve } = useWindow<Lancamento>();
  const { feedback } = useUi();
  const form = useForm<Valores>({
    resolver: zodResolver(schema),
    defaultValues: {
      codigoLoja: lancamento ? String(lancamento.codigoLoja) : lojas.length === 1 ? String(lojas[0]!.codigo) : "",
      produtoId: lancamento?.produtoId ?? "",
      quantidade: lancamento ? String(lancamento.quantidade) : "",
      validade: lancamento?.validade ?? "",
    },
  });

  const onSubmit = async (valores: Valores) => {
    try {
      const salvo = lancamento
        ? await apiFetch<Lancamento>(`${BASE}/lancamentos/${lancamento.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quantidade: Number(valores.quantidade), validade: valores.validade, version: lancamento.version }),
          })
        : await apiFetch<Lancamento>(`${BASE}/lancamentos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ periodoId, codigoLoja: Number(valores.codigoLoja), produtoId: valores.produtoId, quantidade: Number(valores.quantidade), validade: valores.validade }),
          });
      feedback.notify({ type: "success", title: lancamento ? "Lançamento alterado." : "Pré-vencido lançado." });
      resolve(salvo);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao salvar o lançamento."));
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="lancamento-pre-vencido-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            {/* Na edição o produto não muda; o nome já aparece na descrição da janela. */}
            {!lancamento && (
              <>
                <FormField
                  control={form.control}
                  name="codigoLoja"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Loja</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger aria-label="Loja">
                            <SelectValue>{(codigo: string) => lojas.find((l) => String(l.codigo) === codigo)?.nome || "Selecione"}</SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {lojas.map((l) => (
                            <SelectItem key={l.codigo} value={String(l.codigo)}>
                              {l.nome || `Loja ${l.codigo}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="produtoId"
                  render={() => (
                    <FormItem>
                      <ProdutoBusca
                        id="pre-vencido-busca"
                        url={`${BASE}/produtos`}
                        onChange={(p) => form.setValue("produtoId", p?.id ?? "", { shouldValidate: form.formState.isSubmitted })}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
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
        <Button type="submit" form="lancamento-pre-vencido-form" disabled={form.formState.isSubmitting}>
          {lancamento ? "Salvar" : "Lançar"}
        </Button>
      </WindowActions>
    </>
  );
}
