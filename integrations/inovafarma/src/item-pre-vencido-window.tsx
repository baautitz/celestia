import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@platform/ui/components/button";
import { DatePicker } from "@platform/ui/components/date-picker";
import { FieldGroup } from "@platform/ui/components/field";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
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

/** O que a gravação devolve: a edição vem sem o Restante, que depende das vendas do ERP. */
export type ItemSalvo = Omit<ItemPreVencido, "restante"> & { restante?: number };

/** Dia local `AAAA-MM-DD` de uma data. */
const diaLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dataBr = (dia: string) => dia.split("-").reverse().join("/");

/** Início do Closing Period aberto de hoje: até onde a inclusão de um Item pode retroagir. */
export const inicioDoPeriodoAbertoHoje = (periodos: readonly { startDate: string; endDate: string; status?: "open" | "closed" }[]) => {
  const hoje = diaLocal(new Date());
  return periodos.find((p) => p.status !== "closed" && p.startDate <= hoje && hoje <= p.endDate)?.startDate;
};

const esquema = (retroagirAte: string | undefined) =>
  z
    .object({
      produtoId: z.string().min(1, "Busque e selecione o produto."),
      quantidade: z.string().regex(/^[1-9]\d{0,6}$/, "Informe uma quantidade inteira maior que zero."),
      validade: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Informe a validade (mês e ano)."),
      incluidoEm: z.date().optional(),
    })
    .superRefine(({ incluidoEm }, ctx) => {
      if (!incluidoEm || !retroagirAte) return;
      const dia = diaLocal(incluidoEm);
      if (dia > diaLocal(new Date())) ctx.addIssue({ code: "custom", path: ["incluidoEm"], message: "A data de inclusão não pode ser no futuro." });
      else if (dia < retroagirAte) ctx.addIssue({ code: "custom", path: ["incluidoEm"], message: `A data de inclusão não pode ser antes do início do Período aberto (${dataBr(retroagirAte)}).` });
    });
type Valores = z.infer<ReturnType<typeof esquema>>;

interface Props {
  codigoLoja: number;
  /** Presente na edição: só quantidade e validade mudam. */
  item?: ItemPreVencido;
  /**
   * Só para quem gere as Baixas: a data de inclusão pode retroagir até este dia (`AAAA-MM-DD`). Na edição, só se o Item
   * foi incluído a partir dele (o incluído antes já entrou num Período fechado).
   */
  retroagirAte?: string;
}

/** Janela de Item de Pré-vencido (incluir ou editar) no Estoque de uma Loja; resolve com o Item salvo. */
export function ItemPreVencidoWindow({ codigoLoja, item, retroagirAte }: Props) {
  const { resolve } = useWindow<ItemSalvo>();
  const { feedback } = useUi();
  const diaIncluido = item ? diaLocal(new Date(item.incluidoEm)) : undefined;
  const comData = retroagirAte !== undefined && (diaIncluido === undefined || diaIncluido >= retroagirAte);
  const form = useForm<Valores>({
    resolver: zodResolver(esquema(retroagirAte)),
    defaultValues: {
      produtoId: item?.produtoId ?? "",
      quantidade: item ? String(item.quantidade) : "",
      validade: item?.validade ?? "",
      incluidoEm: comData && item ? new Date(item.incluidoEm) : undefined,
    },
  });

  const onSubmit = async (valores: Valores) => {
    // Só vai a data que mudou: sem ela, a inclusão fica agora (ou como estava, na edição).
    const dia = comData && valores.incluidoEm ? diaLocal(valores.incluidoEm) : undefined;
    const corpo = { quantidade: Number(valores.quantidade), validade: valores.validade, ...(dia && dia !== diaIncluido ? { incluidoEm: dia } : {}) };
    try {
      const salvo = item
        ? await apiFetch<ItemSalvo>(`${BASE}/estoque/itens/${item.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...corpo, version: item.version }),
          })
        : await apiFetch<ItemSalvo>(`${BASE}/estoque/itens`, {
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
            {comData && (
              <FormField
                control={form.control}
                name="incluidoEm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de inclusão</FormLabel>
                    <FormControl>
                      <DatePicker value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormDescription>
                      {item ? "" : "Em branco, agora. "}Pode retroagir até {dataBr(retroagirAte)}, para que as vendas desde então gerem Baixas.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
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
