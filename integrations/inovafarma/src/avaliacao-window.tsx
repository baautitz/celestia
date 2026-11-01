import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@platform/ui/components/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@platform/ui/components/combobox";
import { Field, FieldGroup } from "@platform/ui/components/field";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { Input } from "@platform/ui/components/input";
import { Label } from "@platform/ui/components/label";
import { MoneyInput } from "@platform/ui/components/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Textarea } from "@platform/ui/components/textarea";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";

const BASE = "/api/m/inovafarma/avaliacoes";
export const MAX_DESCRICAO = 500;

export interface Avaliacao {
  id: string;
  periodoId: string;
  codigoColaborador: number;
  nomeColaborador: string;
  codigoLoja: number;
  descricao: string;
  /** Valor descontado em reais. */
  valor: number;
  version: number;
  criadoEm: string;
  /** Nome de quem lançou; só na lista de quem gerencia. */
  lancadoPor?: string;
}

export interface LojaOpcao {
  codigo: number;
  nome: string;
}

export interface ColaboradorOpcao {
  codigoColaborador: number;
  nome: string;
  usuario: string | null;
  /** Lojas do Colaborador que quem lança gerencia. */
  lojas: number[];
}

/** O rótulo também é o texto da busca: nome, código InovaFarma e usuário do sistema. */
export const rotuloColaborador = (c: ColaboradorOpcao) => `${c.codigoColaborador} · ${c.nome}${c.usuario ? ` (${c.usuario})` : ""}`;

const schema = z.object({
  codigoColaborador: z.string().min(1, "Selecione o Colaborador."),
  codigoLoja: z.string().min(1, "Selecione a Loja."),
  descricao: z.string().trim().min(1, "Informe a descrição.").max(MAX_DESCRICAO, `A descrição deve ter no máximo ${MAX_DESCRICAO} caracteres.`),
  valor: z.number({ invalid_type_error: "Informe o valor descontado.", required_error: "Informe o valor descontado." }).min(0),
});
type Valores = z.input<typeof schema>;

interface Props {
  periodoId: string;
  lojas: LojaOpcao[];
  /** Presente na edição: só descrição e valor mudam. */
  avaliacao?: Avaliacao;
}

/** Janela de Avaliação do Colaborador (lançar ou editar); resolve com a Avaliação salva. */
export function AvaliacaoWindow({ periodoId, lojas, avaliacao }: Props) {
  const { resolve } = useWindow<Avaliacao>();
  const { feedback } = useUi();
  const [colaboradores, setColaboradores] = useState<ColaboradorOpcao[]>([]);
  const [escolhido, setEscolhido] = useState<ColaboradorOpcao | null>(null);
  const form = useForm<Valores>({
    resolver: zodResolver(schema),
    defaultValues: {
      codigoColaborador: avaliacao ? String(avaliacao.codigoColaborador) : "",
      codigoLoja: avaliacao ? String(avaliacao.codigoLoja) : "",
      descricao: avaliacao?.descricao ?? "",
      valor: avaliacao?.valor,
    },
  });

  // Poucos Colaboradores por Loja: a lista vem inteira e a busca filtra no navegador.
  useEffect(() => {
    if (avaliacao) return;
    apiFetch<ColaboradorOpcao[]>(`${BASE}/colaboradores`)
      .then(setColaboradores)
      .catch((err: unknown) => feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar os Colaboradores.")));
  }, [avaliacao, feedback]);

  const lojasDoEscolhido = lojas.filter((l) => escolhido?.lojas.includes(l.codigo));

  const escolher = (colaborador: ColaboradorOpcao | null) => {
    setEscolhido(colaborador);
    const validar = { shouldValidate: form.formState.isSubmitted };
    form.setValue("codigoColaborador", colaborador ? String(colaborador.codigoColaborador) : "", validar);
    // Com uma só Loja em comum, ela já fica escolhida.
    form.setValue("codigoLoja", colaborador?.lojas.length === 1 ? String(colaborador.lojas[0]) : "", validar);
  };

  const onSubmit = async (valores: Valores) => {
    const corpo = { descricao: valores.descricao.trim(), valor: valores.valor };
    try {
      const salva = avaliacao
        ? await apiFetch<Avaliacao>(`${BASE}/${avaliacao.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...corpo, version: avaliacao.version }),
          })
        : await apiFetch<Avaliacao>(BASE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...corpo, periodoId, codigoColaborador: Number(valores.codigoColaborador), codigoLoja: Number(valores.codigoLoja) }),
          });
      feedback.notify({ type: "success", title: avaliacao ? "Avaliação alterada." : "Avaliação lançada." });
      resolve(salva);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao salvar a Avaliação."));
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="avaliacao-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            {avaliacao ? (
              <Field>
                <Label htmlFor="avaliacao-colaborador-atual">Colaborador</Label>
                <Input id="avaliacao-colaborador-atual" readOnly value={avaliacao.nomeColaborador} />
              </Field>
            ) : (
              <>
                <FormField
                  control={form.control}
                  name="codigoColaborador"
                  render={() => (
                    <FormItem>
                      <Label htmlFor="avaliacao-colaborador">Colaborador</Label>
                      <Combobox
                        autoHighlight
                        items={colaboradores}
                        value={escolhido}
                        onValueChange={(c: ColaboradorOpcao | null) => escolher(c)}
                        itemToStringLabel={rotuloColaborador}
                        itemToStringValue={(c: ColaboradorOpcao) => String(c.codigoColaborador)}
                        isItemEqualToValue={(a: ColaboradorOpcao, b: ColaboradorOpcao) => a.codigoColaborador === b.codigoColaborador}
                      >
                        <ComboboxInput id="avaliacao-colaborador" autoFocus placeholder="Nome, código ou usuário" />
                        <ComboboxContent>
                          <ComboboxEmpty>Nenhum Colaborador encontrado.</ComboboxEmpty>
                          <ComboboxList>
                            {(c: ColaboradorOpcao) => (
                              <ComboboxItem key={c.codigoColaborador} value={c}>
                                {rotuloColaborador(c)}
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="codigoLoja"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Loja</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange} disabled={!escolhido}>
                        <FormControl>
                          <SelectTrigger aria-label="Loja">
                            <SelectValue>{(codigo: string) => lojas.find((l) => String(l.codigo) === codigo)?.nome || (codigo ? `Loja ${codigo}` : "Selecione")}</SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {lojasDoEscolhido.map((l) => (
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
              </>
            )}
            <FormField
              control={form.control}
              name="descricao"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição</FormLabel>
                  <FormControl>
                    <Textarea maxLength={MAX_DESCRICAO} rows={4} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="valor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Valor descontado</FormLabel>
                  <FormControl>
                    <MoneyInput value={field.value ?? null} onValueChange={(valor, texto) => field.onChange(texto === "" ? undefined : valor)} onBlur={field.onBlur} name={field.name} />
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
        <Button type="submit" form="avaliacao-form" disabled={form.formState.isSubmitting}>
          {avaliacao ? "Salvar" : "Lançar"}
        </Button>
      </WindowActions>
    </>
  );
}
