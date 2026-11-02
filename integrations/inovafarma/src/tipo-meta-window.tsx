import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Button } from "@platform/ui/components/button";
import { FieldGroup } from "@platform/ui/components/field";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { Input } from "@platform/ui/components/input";
import { Label } from "@platform/ui/components/label";
import { Stack } from "@platform/ui/components/layout";
import { MoneyInput } from "@platform/ui/components/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Switch } from "@platform/ui/components/switch";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { INDICADORES, indicadorPorId, type IndicadorId } from "./indicadores";
import { EXIBICAO_LABEL, REGRA_LABEL, descreverPremio, problemaDoTipo, type DadosTipoMeta, type Exibicao, type RegraPremio, type TipoMeta, type TipoRegra } from "./tipos-meta";

export const BASE = "/api/m/inovafarma/metas/tipos";

export type TipoMetaComPremio = TipoMeta & { premio: string };

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Indicadores de valor vendido em R$, base do Percentual. */
const BASES_PERCENTUAL = INDICADORES.filter((i) => i.unidade === "reais" && i.id !== "avaliacoes" && i.id !== "ticket-medio");

const schema = z.object({
  nome: z.string().trim().min(1, "Informe o nome do Tipo de Meta.").max(80, "O nome deve ter no máximo 80 caracteres."),
  indicador: z.string() as z.ZodType<IndicadorId>,
  semAlvo: z.boolean(),
  exibicao: z.string() as z.ZodType<Exibicao>,
  mostrarPremio: z.boolean(),
  regraTipo: z.string() as z.ZodType<TipoRegra>,
  /** Em R$ (o MoneyInput trabalha em reais). */
  valor: z.number(),
  gatilho: z.string(),
  teto: z.string(),
  faixas: z.array(z.object({ atingimento: z.string(), valor: z.number() })),
  percentual: z.string(),
  indicadorBase: z.string() as z.ZodType<IndicadorId>,
  soSeAtingir: z.boolean(),
  /** R$ em reais quando o Indicador é em R$; senão, o número digitado. */
  alvoPadrao: z.union([z.number(), z.string()]),
  ativo: z.boolean(),
});
type Valores = z.infer<typeof schema>;

const centavos = (reais: number) => Math.round(reais * 100);
const numeroOuNull = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

/** Opções de regra que fazem sentido para o Indicador (sem Proporcional quando menor é melhor). */
export function regrasPermitidas(indicador: IndicadorId, semAlvo: boolean): TipoRegra[] {
  if (indicador === "avaliacoes") return ["saldo"];
  if (semAlvo) return ["percentual"];
  const regras: TipoRegra[] = ["fixo", "proporcional", "faixas", "percentual"];
  return indicadorPorId(indicador).direcao === "menor" ? regras.filter((r) => r !== "proporcional") : regras;
}

const exibicoesPermitidas = (indicador: IndicadorId, semAlvo: boolean): Exibicao[] =>
  semAlvo ? ["progresso"] : indicador === "lista-produtos" ? ["atingida", "progresso", "contagem"] : ["atingida", "progresso"];

const temAlvoPadrao = (indicador: IndicadorId, semAlvo: boolean) => !semAlvo && indicador !== "lista-produtos";

function regraDe(v: Valores): RegraPremio {
  switch (v.regraTipo) {
    case "fixo":
      return { tipo: "fixo", valorCentavos: centavos(v.valor) };
    case "proporcional":
      return { tipo: "proporcional", valorCentavos: centavos(v.valor), gatilho: numeroOuNull(v.gatilho), teto: numeroOuNull(v.teto) };
    case "faixas":
      return { tipo: "faixas", faixas: v.faixas.map((f) => ({ atingimento: Number(f.atingimento.replace(",", ".")) || 0, valorCentavos: centavos(f.valor) })) };
    case "percentual":
      return { tipo: "percentual", percentual: numeroOuNull(v.percentual) ?? 0, indicadorBase: v.indicadorBase, soSeAtingir: !v.semAlvo && v.soSeAtingir };
    case "saldo":
      return { tipo: "saldo" };
  }
}

/** Os valores do formulário no formato da API. */
export function dadosDe(v: Valores): DadosTipoMeta {
  const emReais = indicadorPorId(v.indicador).unidade === "reais";
  const alvo = !temAlvoPadrao(v.indicador, v.semAlvo) ? null : typeof v.alvoPadrao === "number" ? (v.alvoPadrao > 0 ? v.alvoPadrao : null) : numeroOuNull(v.alvoPadrao);
  return {
    nome: v.nome.trim(),
    indicador: v.indicador,
    exibicao: v.exibicao,
    mostrarPremio: v.mostrarPremio,
    semAlvo: v.semAlvo,
    regra: regraDe(v),
    alvoPadrao: alvo === null ? null : emReais ? centavos(alvo) : alvo,
    ativo: v.ativo,
  };
}

function iniciais(tipo?: TipoMeta): Valores {
  const r = tipo?.regra;
  const emReais = tipo ? indicadorPorId(tipo.indicador).unidade === "reais" : false;
  return {
    nome: tipo?.nome ?? "",
    indicador: tipo?.indicador ?? "ticket-medio",
    semAlvo: tipo?.semAlvo ?? false,
    exibicao: tipo?.exibicao ?? "atingida",
    mostrarPremio: tipo?.mostrarPremio ?? true,
    regraTipo: r?.tipo ?? "fixo",
    valor: r && (r.tipo === "fixo" || r.tipo === "proporcional") ? r.valorCentavos / 100 : 0,
    gatilho: r?.tipo === "proporcional" && r.gatilho !== null ? String(r.gatilho) : "",
    teto: r?.tipo === "proporcional" && r.teto !== null ? String(r.teto) : "",
    faixas: r?.tipo === "faixas" ? r.faixas.map((f) => ({ atingimento: String(f.atingimento), valor: f.valorCentavos / 100 })) : [{ atingimento: "100", valor: 0 }],
    percentual: r?.tipo === "percentual" ? String(r.percentual) : "",
    indicadorBase: r?.tipo === "percentual" ? r.indicadorBase : "foco-valor",
    soSeAtingir: r?.tipo === "percentual" ? r.soSeAtingir : true,
    alvoPadrao: tipo?.alvoPadrao == null ? "" : emReais ? tipo.alvoPadrao / 100 : String(tipo.alvoPadrao),
    ativo: tipo?.ativo ?? true,
  };
}

/** Resultado da janela: o Tipo de Meta gravado e se o Alvo padrão mudou (para abrir a janela de aplicação). */
export interface TipoMetaSalvo {
  tipo: TipoMetaComPremio;
  alvoPadraoMudou: boolean;
}

/** Janela para cadastrar ou alterar um Tipo de Meta, com a prévia do Prêmio; resolve quando salva. */
export function TipoMetaWindow({ tipo }: { tipo?: TipoMeta }) {
  const { resolve } = useWindow<TipoMetaSalvo>();
  const { feedback } = useUi();
  const form = useForm<Valores>({ resolver: zodResolver(schema), defaultValues: iniciais(tipo) });
  const faixas = useFieldArray({ control: form.control, name: "faixas" });
  const v = useWatch({ control: form.control }) as Valores;
  const indicador = indicadorPorId(v.indicador);
  const avaliacoes = v.indicador === "avaliacoes";
  const regras = regrasPermitidas(v.indicador, v.semAlvo);
  const exibicoes = exibicoesPermitidas(v.indicador, v.semAlvo);
  const dados = dadosDe(v);
  const problema = problemaDoTipo(dados);

  /** Ao trocar o Indicador ou o "sem Alvo", leva a regra e a Exibição para uma opção válida. */
  const ajustar = (indicadorId: IndicadorId, semAlvo: boolean) => {
    const permitidas = regrasPermitidas(indicadorId, semAlvo);
    if (!permitidas.includes(form.getValues("regraTipo"))) form.setValue("regraTipo", permitidas[0]!);
    const exib = exibicoesPermitidas(indicadorId, semAlvo);
    if (!exib.includes(form.getValues("exibicao"))) form.setValue("exibicao", exib[0]!);
    if (indicadorId === "avaliacoes" || indicadorId === "lista-produtos") form.setValue("semAlvo", false);
  };

  const onSubmit = async (valores: Valores) => {
    const corpo = dadosDe(valores);
    const erro = problemaDoTipo(corpo);
    if (erro) {
      feedback.notifyError(new Error(erro));
      return;
    }
    try {
      const salvo = tipo
        ? await apiFetch<TipoMetaComPremio>(`${BASE}/${tipo.id}`, json("PUT", { ...corpo, version: tipo.version }))
        : await apiFetch<TipoMetaComPremio>(BASE, json("POST", corpo));
      feedback.notify({ type: "success", title: tipo ? "Tipo de Meta alterado." : "Tipo de Meta cadastrado." });
      resolve({ tipo: salvo, alvoPadraoMudou: Boolean(tipo) && salvo.alvoPadrao !== null && salvo.alvoPadrao !== tipo?.alvoPadrao });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao salvar o Tipo de Meta."));
    }
  };

  const percentualCampo = (name: "gatilho" | "teto" | "percentual", label: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input inputMode="decimal" {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const valorCampo = (label: string) => (
    <FormField
      control={form.control}
      name="valor"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <MoneyInput value={field.value} onValueChange={field.onChange} aria-label={label} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const alvoLabel = avaliacoes ? "Valor inicial (opcional)" : `Alvo padrão (opcional, ${indicador.unidade === "percentual" ? "em %" : indicador.unidade === "reais" ? "em R$" : "quantidade"})`;

  return (
    <>
      <Form {...form}>
        <form id="tipo-meta-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
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
            <FormField
              control={form.control}
              name="indicador"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Indicador</FormLabel>
                  <Select
                    value={field.value}
                    disabled={Boolean(tipo)}
                    onValueChange={(id) => {
                      if (!id) return;
                      field.onChange(id);
                      ajustar(id as IndicadorId, form.getValues("semAlvo"));
                    }}
                  >
                    <FormControl>
                      <SelectTrigger aria-label="Indicador">
                        <SelectValue>{(id: IndicadorId) => indicadorPorId(id)?.nome ?? "Selecione"}</SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {INDICADORES.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.nome}
                          {i.direcao === "menor" ? " (menor é melhor)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {!avaliacoes && v.indicador !== "lista-produtos" && (
              <FormField
                control={form.control}
                name="semAlvo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sem Alvo (comissão pura)</FormLabel>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={(semAlvo: boolean) => {
                          field.onChange(semAlvo);
                          ajustar(form.getValues("indicador"), semAlvo);
                        }}
                        aria-label="Sem Alvo (comissão pura)"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="exibicao"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Exibição para o Colaborador</FormLabel>
                  <Select value={field.value} onValueChange={(e) => e && field.onChange(e)}>
                    <FormControl>
                      <SelectTrigger aria-label="Exibição para o Colaborador">
                        <SelectValue>{(e: Exibicao) => EXIBICAO_LABEL[e]}</SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {exibicoes.map((e) => (
                        <SelectItem key={e} value={e}>
                          {EXIBICAO_LABEL[e]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="mostrarPremio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mostrar o Prêmio ao Colaborador</FormLabel>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Mostrar o Prêmio ao Colaborador" />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="regraTipo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Regra do Prêmio</FormLabel>
                  <Select value={field.value} onValueChange={(r) => r && field.onChange(r)}>
                    <FormControl>
                      <SelectTrigger aria-label="Regra do Prêmio">
                        <SelectValue>{(r: TipoRegra) => REGRA_LABEL[r]}</SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {regras.map((r) => (
                        <SelectItem key={r} value={r}>
                          {REGRA_LABEL[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            {v.regraTipo === "fixo" && valorCampo("Prêmio se atingir")}
            {v.regraTipo === "proporcional" && (
              <>
                {valorCampo("Prêmio a 100% de Atingimento")}
                {percentualCampo("gatilho", "Gatilho (% de Atingimento, opcional)")}
                {percentualCampo("teto", "Teto (% de Atingimento, opcional)")}
              </>
            )}
            {v.regraTipo === "faixas" && (
              <Stack gap="field">
                <Label>Faixas (% de Atingimento e Prêmio)</Label>
                {faixas.fields.map((f, i) => (
                  <Stack key={f.id} direction="row" gap="field" align="end">
                    <FormField
                      control={form.control}
                      name={`faixas.${i}.atingimento`}
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input inputMode="decimal" aria-label={`Atingimento da Faixa ${i + 1}`} {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`faixas.${i}.valor`}
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <MoneyInput value={field.value} onValueChange={field.onChange} aria-label={`Prêmio da Faixa ${i + 1}`} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <Button type="button" size="icon" variant="ghost" tone="destructive" aria-label={`Remover Faixa ${i + 1}`} disabled={faixas.fields.length === 1} onClick={() => faixas.remove(i)}>
                      <Trash2 />
                    </Button>
                  </Stack>
                ))}
                <Button type="button" variant="outline" onClick={() => faixas.append({ atingimento: "", valor: 0 })}>
                  <Plus />
                  Adicionar Faixa
                </Button>
              </Stack>
            )}
            {v.regraTipo === "percentual" && (
              <>
                {percentualCampo("percentual", "Percentual (%)")}
                <FormField
                  control={form.control}
                  name="indicadorBase"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sobre o Indicador</FormLabel>
                      <Select value={field.value} onValueChange={(id) => id && field.onChange(id)}>
                        <FormControl>
                          <SelectTrigger aria-label="Sobre o Indicador">
                            <SelectValue>{(id: IndicadorId) => indicadorPorId(id)?.nome ?? "Selecione"}</SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {BASES_PERCENTUAL.map((i) => (
                            <SelectItem key={i.id} value={i.id}>
                              {i.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                {!v.semAlvo && (
                  <FormField
                    control={form.control}
                    name="soSeAtingir"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Só paga se atingir o Alvo</FormLabel>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Só paga se atingir o Alvo" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                )}
              </>
            )}
            {temAlvoPadrao(v.indicador, v.semAlvo) && (
              <FormField
                control={form.control}
                name="alvoPadrao"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{alvoLabel}</FormLabel>
                    <FormControl>
                      {indicador.unidade === "reais" ? (
                        <MoneyInput value={typeof field.value === "number" ? field.value : null} onValueChange={field.onChange} aria-label={alvoLabel} />
                      ) : (
                        <Input inputMode="decimal" value={String(field.value)} onChange={field.onChange} aria-label={alvoLabel} />
                      )}
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {tipo && (
              <FormField
                control={form.control}
                name="ativo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ativo</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Ativo" />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}
            <Alert variant={problema ? "destructive" : "default"}>
              <AlertTitle>Prévia do Prêmio</AlertTitle>
              <AlertDescription>{problema ?? descreverPremio(dados)}</AlertDescription>
            </Alert>
          </FieldGroup>
        </form>
      </Form>
      <WindowActions>
        <WindowCancelButton />
        <Button type="submit" form="tipo-meta-form" disabled={form.formState.isSubmitting}>
          {tipo ? "Salvar" : "Cadastrar"}
        </Button>
      </WindowActions>
    </>
  );
}
