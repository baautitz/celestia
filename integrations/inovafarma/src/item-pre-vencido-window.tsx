import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@platform/ui/components/button";
import { DatePicker } from "@platform/ui/components/date-picker";
import { FieldGroup } from "@platform/ui/components/field";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { Input } from "@platform/ui/components/input";
import { Label } from "@platform/ui/components/label";
import { Stack } from "@platform/ui/components/layout";
import { MonthPicker } from "@platform/ui/components/month-picker";
import { Switch } from "@platform/ui/components/switch";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { dataBr } from "./datas";
import { ProdutoBusca } from "./produto-busca";
import { API } from "./inovafarma-api";

const BASE = `${API}/pre-vencidos`;

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
  abrangenciaEm: string;
  version: number;
}

/** O que a gravação devolve: a edição vem sem o Restante, que depende das vendas do ERP. */
export type ItemSalvo = Omit<ItemPreVencido, "restante"> & { restante?: number };

/** Limites da data de abrangência retroativa, calculados pelo servidor na hora do ERP (`AAAA-MM-DD`). */
export interface InclusaoRetroativa {
  /** Início do Closing Period aberto: a data não vai antes dele. */
  inicio: string;
  /** Hoje: a data não vai para o futuro. */
  hoje: string;
}

/** Dia `AAAA-MM-DD` escolhido no calendário. */
const diaLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** `AAAA-MM-DD` como data local, meia-noite. */
const paraData = (dia: string) => {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(a ?? 0, (m ?? 1) - 1, d ?? 1);
};

const esquema = (retroativa: InclusaoRetroativa | undefined) =>
  z
    .object({
      produtoId: z.string().min(1, "Busque e selecione o produto."),
      quantidade: z.string().regex(/^[1-9]\d{0,6}$/, "Informe uma quantidade inteira maior que zero."),
      validade: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Informe a validade (mês e ano)."),
      abrangenciaEm: z.date().optional(),
    })
    .superRefine(({ abrangenciaEm }, ctx) => {
      if (!abrangenciaEm || !retroativa) return;
      const dia = diaLocal(abrangenciaEm);
      if (dia > retroativa.hoje) ctx.addIssue({ code: "custom", path: ["abrangenciaEm"], message: "A data de abrangência não pode ser no futuro." });
      else if (dia < retroativa.inicio) ctx.addIssue({ code: "custom", path: ["abrangenciaEm"], message: `A data de abrangência não pode ser antes do início do Período aberto (${dataBr(retroativa.inicio)}).` });
    });
type Valores = z.infer<ReturnType<typeof esquema>>;

interface Props {
  codigoLoja: number;
  /** Presente na edição: só quantidade e validade mudam. */
  item?: ItemPreVencido;
  /**
   * Só para quem gere as Baixas: a data de abrangência pode retroagir até o início do Período aberto. Na edição, só se o
   * Item foi incluído a partir dele (o incluído antes já entrou num Período fechado).
   */
  retroativa?: InclusaoRetroativa;
  /** Chamado a cada Item salvo com "Adicionar mais" ligado, em que a janela segue aberta para o próximo. */
  onSalvo?: (salvo: ItemSalvo) => void;
}

/** Janela de Item de Pré-vencido (incluir ou editar) no Estoque de uma Loja; resolve com o Item salvo. */
export function ItemPreVencidoWindow({ codigoLoja, item, retroativa, onSalvo }: Props) {
  const { resolve } = useWindow<ItemSalvo>();
  const { feedback } = useUi();
  const [adicionarMais, setAdicionarMais] = useState(false);
  // Muda a cada Item salvo com "Adicionar mais": remonta a busca de produto, que guarda a escolha por dentro.
  const [rodada, setRodada] = useState(0);
  const diaIncluido = item ? diaLocal(new Date(item.abrangenciaEm)) : undefined;
  const comData = retroativa !== undefined && (diaIncluido === undefined || diaIncluido >= retroativa.inicio);
  const form = useForm<Valores>({
    resolver: zodResolver(esquema(retroativa)),
    defaultValues: {
      produtoId: item?.produtoId ?? "",
      quantidade: item ? String(item.quantidade) : "",
      validade: item?.validade ?? "",
      // Pré-preenchida: na inclusão, hoje; na edição, a data que o Item já tem.
      abrangenciaEm: !comData ? undefined : item ? new Date(item.abrangenciaEm) : paraData(retroativa.hoje),
    },
  });

  const onSubmit = async (valores: Valores) => {
    // Só vai a data que mudou: sem ela, a inclusão fica agora (ou como estava, na edição).
    // Hoje na inclusão é "agora": só vai ao servidor uma data diferente dela.
    const dia = comData && valores.abrangenciaEm && !(!item && diaLocal(valores.abrangenciaEm) === retroativa?.hoje) ? diaLocal(valores.abrangenciaEm) : undefined;
    const corpo = { quantidade: Number(valores.quantidade), validade: valores.validade, ...(dia && dia !== diaIncluido ? { abrangenciaEm: dia } : {}) };
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
      if (!item && adicionarMais) {
        onSalvo?.(salvo);
        form.reset({ produtoId: "", quantidade: "", validade: valores.validade, abrangenciaEm: valores.abrangenciaEm });
        setRodada((r) => r + 1);
        return;
      }
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
                      key={rodada}
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
                name="abrangenciaEm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de abrangência</FormLabel>
                    <FormControl>
                      <DatePicker value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormDescription>
                      Pode retroagir até {dataBr(retroativa.inicio)}, para que as vendas desde então gerem Baixas.
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
        {!item && (
          <Stack direction="row" align="center" gap="field">
            <Switch id="item-pre-vencido-adicionar-mais" checked={adicionarMais} onCheckedChange={(on: boolean) => setAdicionarMais(on)} />
            <Label htmlFor="item-pre-vencido-adicionar-mais">Adicionar mais</Label>
          </Stack>
        )}
        <WindowCancelButton />
        <Button type="submit" form="item-pre-vencido-form" disabled={form.formState.isSubmitting}>
          {item ? "Salvar" : "Incluir"}
        </Button>
      </WindowActions>
    </>
  );
}
