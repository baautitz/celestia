import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@platform/ui/components/button";
import { FieldGroup } from "@platform/ui/components/field";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { Input } from "@platform/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Textarea } from "@platform/ui/components/textarea";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { API, json } from "./inovafarma-api";
import type { LojaOpcao } from "./loja-opcao";
import { MAX_OBSERVACAO_FALTEIRO, type Falta } from "./pedidos-falteiro";
import { ProdutoBusca } from "./produto-busca";

export const FALTEIRO_BASE = `${API}/pedidos/falteiro`;
const TODAS = "todas";

const schema = z.object({
  produtoId: z.string().min(1, "Busque e selecione o produto."),
  loja: z.string().min(1, "Selecione a Loja."),
  quantidade: z.string().refine((v) => v.trim() === "" || /^[1-9]\d{0,6}$/.test(v.trim()), {
    error: "Informe uma quantidade inteira maior que zero.",
  }),
  observacao: z.string().max(MAX_OBSERVACAO_FALTEIRO, `A observação deve ter no máximo ${MAX_OBSERVACAO_FALTEIRO} caracteres.`),
});
type Valores = z.infer<typeof schema>;

export interface FalteiroWindowProps {
  lojas: LojaOpcao[];
  todasAsLojas: boolean;
  /** Presente na edição de uma falta existente. */
  falta?: Falta & { nomeProduto?: string };
  /** Presente quando aberto pelo atalho rápido do Lançamento para um produto já determinado. */
  produtoFixo?: { id: string; nome: string };
}

/** Janela para registrar ou editar falta no Falteiro; resolve com a Falta salva. */
export function FalteiroWindow({ lojas, todasAsLojas, falta, produtoFixo }: FalteiroWindowProps) {
  const { resolve } = useWindow<Falta>();
  const { feedback } = useUi();

  const lojaPadrao = falta
    ? falta.codigoLoja === null
      ? TODAS
      : String(falta.codigoLoja)
    : todasAsLojas
      ? TODAS
      : String(lojas[0]?.codigo ?? "");

  const form = useForm<Valores>({
    resolver: zodResolver(schema),
    defaultValues: {
      produtoId: falta?.produtoId ?? produtoFixo?.id ?? "",
      loja: lojaPadrao,
      quantidade: falta?.quantidade != null ? String(falta.quantidade) : "",
      observacao: falta?.observacao ?? "",
    },
  });

  const rotuloLoja = (valor: string) => {
    if (valor === TODAS) return "Todas as Lojas";
    const encontrada = lojas.find((l) => String(l.codigo) === valor);
    return encontrada ? encontrada.nome || `Loja ${encontrada.codigo}` : "Selecione a Loja";
  };

  const onSubmit = async (valores: Valores) => {
    const codigoLoja = valores.loja === TODAS ? null : Number(valores.loja);
    const quantidade = valores.quantidade.trim() === "" ? null : Number(valores.quantidade.trim());
    const observacao = valores.observacao.trim() || null;

    try {
      const salva = falta
        ? await apiFetch<Falta>(`${FALTEIRO_BASE}/${falta.id}`, json("PUT", { codigoLoja, quantidade, observacao, version: falta.version }))
        : await apiFetch<Falta>(FALTEIRO_BASE, json("POST", { produtoId: valores.produtoId, codigoLoja, quantidade, observacao }));
      feedback.notify({ type: "success", title: falta ? "Falta atualizada." : "Falta registrada no Falteiro." });
      resolve(salva);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao salvar o registro do Falteiro."));
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="falteiro-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            {!falta && !produtoFixo && (
              <FormField
                control={form.control}
                name="produtoId"
                render={() => (
                  <FormItem>
                    <ProdutoBusca
                      id="falteiro-produto-busca"
                      url={`${FALTEIRO_BASE}/produtos`}
                      onChange={(p) => form.setValue("produtoId", p?.id ?? "", { shouldValidate: form.formState.isSubmitted })}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="loja"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Loja</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger aria-label="Loja">
                        <SelectValue>{(v: string) => rotuloLoja(v)}</SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {todasAsLojas && <SelectItem value={TODAS}>Todas as Lojas</SelectItem>}
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
              name="quantidade"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantidade desejada (opcional)</FormLabel>
                  <FormControl>
                    <Input type="number" inputMode="numeric" min={1} step={1} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="observacao"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observação (opcional)</FormLabel>
                  <FormControl>
                    <Textarea maxLength={MAX_OBSERVACAO_FALTEIRO} rows={3} {...field} />
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
        <Button type="submit" form="falteiro-form" disabled={form.formState.isSubmitting}>
          {falta ? "Salvar" : "Registrar"}
        </Button>
      </WindowActions>
    </>
  );
}
