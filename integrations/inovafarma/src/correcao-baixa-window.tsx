import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@platform/ui/components/button";
import { FieldGroup } from "@platform/ui/components/field";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { Input } from "@platform/ui/components/input";
import { Textarea } from "@platform/ui/components/textarea";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";

const BASE = "/api/m/inovafarma/pre-vencidos";

/** Correção de Baixa como a API devolve. */
export interface CorrecaoDaBaixa {
  id: string;
  quantidade: number;
  motivo: string;
  autorNome?: string;
  version: number;
}

/** A venda corrigida: a linha de venda e quanto dela baixou. */
export interface VendaParaCorrigir {
  vendaId: number;
  produtoId: string;
  nomeProduto: string;
  quantidadeVendida: number;
  quantidade: number;
  correcao?: CorrecaoDaBaixa;
}

interface Props {
  codigoLoja: number;
  periodoId: string;
  venda: VendaParaCorrigir;
}

const esquema = (maximo: number) =>
  z.object({
    quantidade: z
      .string()
      .regex(/^\d{1,7}$/, "Informe uma quantidade inteira, zero ou mais.")
      .refine((v) => Number(v) <= maximo, `A quantidade vai de 0 até o que a venda teve (${maximo}).`),
    motivo: z.string().trim().min(1, "Informe o motivo da Correção.").max(500, "O motivo tem no máximo 500 caracteres."),
  });
type Valores = z.infer<ReturnType<typeof esquema>>;

/** Janela de Correção de Baixa (corrigir ou alterar a Correção) de uma venda; resolve com a Correção salva. */
export function CorrecaoBaixaWindow({ codigoLoja, periodoId, venda }: Props) {
  const { resolve } = useWindow<CorrecaoDaBaixa>();
  const { feedback } = useUi();
  const form = useForm<Valores>({
    resolver: zodResolver(esquema(venda.quantidadeVendida)),
    defaultValues: { quantidade: String(venda.correcao?.quantidade ?? venda.quantidade), motivo: venda.correcao?.motivo ?? "" },
  });

  const onSubmit = async (valores: Valores) => {
    const corpo = { quantidade: Number(valores.quantidade), motivo: valores.motivo.trim() };
    try {
      const salva = venda.correcao
        ? await apiFetch<CorrecaoDaBaixa>(`${BASE}/baixas/correcoes/${venda.correcao.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...corpo, version: venda.correcao.version }),
          })
        : await apiFetch<CorrecaoDaBaixa>(`${BASE}/baixas/correcoes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ codigoLoja, periodoId, vendaId: venda.vendaId, produtoId: venda.produtoId, ...corpo }),
          });
      feedback.notify({ type: "success", title: venda.correcao ? "Correção alterada." : "Baixa corrigida." });
      resolve(salva);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao salvar a Correção de Baixa."));
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="correcao-baixa-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <FormField
              control={form.control}
              name="quantidade"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantidade de Pré-vencido</FormLabel>
                  <FormControl>
                    <Input type="number" inputMode="numeric" min={0} max={venda.quantidadeVendida} step={1} {...field} />
                  </FormControl>
                  <FormDescription>
                    De 0 a {venda.quantidadeVendida}, o que a venda teve. O que sair volta ao Restante e pode ser baixado pelas vendas seguintes.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="motivo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo</FormLabel>
                  <FormControl>
                    <Textarea rows={3} maxLength={500} {...field} />
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
        <Button type="submit" form="correcao-baixa-form" disabled={form.formState.isSubmitting}>
          {venda.correcao ? "Salvar" : "Corrigir"}
        </Button>
      </WindowActions>
    </>
  );
}
