import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Button } from "@platform/ui/components/button";
import { FieldGroup } from "@platform/ui/components/field";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { Input } from "@platform/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@platform/ui/components/input-group";
import { Label } from "@platform/ui/components/label";
import { Grid, Stack, Text } from "@platform/ui/components/layout";
import { MoneyInput } from "@platform/ui/components/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Switch } from "@platform/ui/components/switch";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { INDICADORES, comUnidade, formatarValor, indicadorPorId, valorNoAtingimento, type Indicador, type IndicadorId } from "./indicadores";
import { ListaProdutosCampo } from "./lista-produtos-campo";
import {
  EXIBICAO_LABEL,
  EntradaLista,
  REGRA_LABEL,
  UNIDADES_LISTA,
  UNIDADE_LISTA_LABEL,
  descreverPremio,
  indicadorDoTipo,
  problemaNoCampo,
  temLista,
  type CampoDoTipo,
  type ProblemaDoTipo,
  type UnidadeLista,
  type DadosTipoMeta, type Exibicao, type RegraPremio, type TipoMeta, type TipoRegra } from "./tipos-meta";

export const BASE = "/api/m/inovafarma/metas/tipos";

/** Como a API devolve o Tipo de Meta: com a prévia do Prêmio e se já tem Metas em algum Período. */
export type TipoMetaComPremio = TipoMeta & { premio: string; temMetas?: boolean };

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Indicadores de valor vendido em R$, base do Percentual. */
const BASES_PERCENTUAL = INDICADORES.filter((i: Indicador) => Boolean(i.valorVendido));

/** O Indicador com a unidade escolhida (a Lista de Produtos mede unidades ou R$). */
const indicadorDe = (indicador: IndicadorId, unidadeLista: UnidadeLista) => indicadorDoTipo({ indicador, lista: { unidade: unidadeLista } });

/** Bases do Percentual: os Indicadores em R$ e, num Tipo de Lista em R$, a própria Lista. */
const basesPercentual = (indicador: IndicadorId, unidadeLista: UnidadeLista): Indicador[] => {
  const proprio = indicadorDe(indicador, unidadeLista);
  return temLista(indicador) && proprio.valorVendido ? [proprio, ...BASES_PERCENTUAL] : BASES_PERCENTUAL;
};

/** Sem Alvo, o Prêmio é um Percentual do próprio Indicador: só vale para Indicadores que servem de base. */
const podeSemAlvo = (indicador: IndicadorId, unidadeLista: UnidadeLista) => Boolean(indicadorDe(indicador, unidadeLista).valorVendido);

/** "Calcular sobre" começa no próprio Indicador quando ele é em R$; senão, vazio. */
const baseInicial = (indicador: IndicadorId, unidadeLista: UnidadeLista): IndicadorId | "" => (podeSemAlvo(indicador, unidadeLista) ? indicador : "");

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
  /** Vazio enquanto o gestor não escolhe a base do Percentual. */
  indicadorBase: z.string() as z.ZodType<IndicadorId | "">,
  soSeAtingir: z.boolean(),
  /** R$ em reais quando o Indicador é em R$; senão, o número digitado. */
  alvoPadrao: z.union([z.number(), z.string()]),
  /** Entradas da Lista de Produtos (só no Indicador Lista de Produtos). */
  entradas: z.array(EntradaLista),
  unidadeLista: z.enum(UNIDADES_LISTA),
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

const exibicoesPermitidas = (semAlvo: boolean): Exibicao[] => (semAlvo ? ["progresso"] : ["atingida", "progresso"]);

const temAlvoPadrao = (semAlvo: boolean) => !semAlvo;

function regraDe(v: Valores): RegraPremio {
  switch (v.regraTipo) {
    case "fixo":
      return { tipo: "fixo", valorCentavos: centavos(v.valor) };
    case "proporcional":
      return { tipo: "proporcional", valorCentavos: centavos(v.valor), gatilho: numeroOuNull(v.gatilho), teto: numeroOuNull(v.teto) };
    case "faixas":
      return { tipo: "faixas", faixas: v.faixas.map((f) => ({ atingimento: Number(f.atingimento.replace(",", ".")) || 0, valorCentavos: centavos(f.valor) })) };
    case "percentual":
      return { tipo: "percentual", percentual: numeroOuNull(v.percentual) ?? 0, indicadorBase: (v.semAlvo ? v.indicador : v.indicadorBase) as IndicadorId, soSeAtingir: !v.semAlvo && v.soSeAtingir };
    case "saldo":
      return { tipo: "saldo" };
  }
}

/** Os valores do formulário no formato da API. */
export function dadosDe(v: Valores): DadosTipoMeta {
  const emReais = indicadorDe(v.indicador, v.unidadeLista).unidade === "reais";
  const alvo = !temAlvoPadrao(v.semAlvo) ? null : typeof v.alvoPadrao === "number" ? (v.alvoPadrao > 0 ? v.alvoPadrao : null) : numeroOuNull(v.alvoPadrao);
  return {
    nome: v.nome.trim(),
    indicador: v.indicador,
    exibicao: v.exibicao,
    mostrarPremio: v.mostrarPremio,
    semAlvo: v.semAlvo,
    regra: regraDe(v),
    alvoPadrao: alvo === null ? null : emReais ? centavos(alvo) : alvo,
    lista: temLista(v.indicador) && v.entradas.length > 0 ? { entradas: v.entradas, unidade: v.unidadeLista } : null,
    ativo: v.ativo,
  };
}

/** O que impede salvar e o campo a que se refere, na ordem em que o gestor preenche; null se o Tipo de Meta é válido. */
function problemaDoFormulario(v: Valores, dados: DadosTipoMeta): ProblemaDoTipo | null {
  if (v.regraTipo === "percentual" && !v.semAlvo && !v.indicadorBase)
    return { campo: "indicadorBase", mensagem: "Escolha em “Calcular sobre” o Indicador em R$ que é a base do Percentual." };
  return problemaNoCampo(dados);
}

function iniciais(tipo?: TipoMeta): Valores {
  const r = tipo?.regra;
  const indicador = tipo?.indicador ?? "ticket-medio";
  const unidadeLista = tipo?.lista?.unidade ?? "unidades";
  const emReais = indicadorDe(indicador, unidadeLista).unidade === "reais";
  return {
    nome: tipo?.nome ?? "",
    indicador,
    semAlvo: tipo?.semAlvo ?? false,
    exibicao: tipo?.exibicao ?? "atingida",
    mostrarPremio: tipo?.mostrarPremio ?? true,
    regraTipo: r?.tipo ?? "fixo",
    valor: r && (r.tipo === "fixo" || r.tipo === "proporcional") ? r.valorCentavos / 100 : 0,
    gatilho: r?.tipo === "proporcional" && r.gatilho !== null ? String(r.gatilho) : "",
    teto: r?.tipo === "proporcional" && r.teto !== null ? String(r.teto) : "",
    faixas: r?.tipo === "faixas" ? r.faixas.map((f) => ({ atingimento: String(f.atingimento), valor: f.valorCentavos / 100 })) : [{ atingimento: "100", valor: 0 }],
    percentual: r?.tipo === "percentual" ? String(r.percentual) : "",
    indicadorBase: r?.tipo === "percentual" ? r.indicadorBase : baseInicial(indicador, unidadeLista),
    soSeAtingir: r?.tipo === "percentual" ? r.soSeAtingir : true,
    alvoPadrao: tipo?.alvoPadrao == null ? "" : emReais ? tipo.alvoPadrao / 100 : String(tipo.alvoPadrao),
    entradas: tipo?.lista?.entradas ?? [],
    unidadeLista,
    ativo: tipo?.ativo ?? true,
  };
}

/** Resultado da janela: o Tipo de Meta gravado e se o Alvo padrão mudou (para abrir a janela de aplicação). */
export interface TipoMetaSalvo {
  tipo: TipoMetaComPremio;
  alvoPadraoMudou: boolean;
}

/**
 * Janela larga para cadastrar ou alterar um Tipo de Meta: "O que mede" à esquerda, "Como paga" à direita e a Prévia do
 * Prêmio embaixo, sempre visível. Resolve quando salva; pede confirmação ao fechar com alterações.
 */
export function TipoMetaWindow({ tipo }: { tipo?: TipoMeta & { temMetas?: boolean } }) {
  const { resolve, setDirtyCheck } = useWindow<TipoMetaSalvo>();
  const { feedback } = useUi();
  const inicial = useRef(iniciais(tipo));
  const form = useForm<Valores>({ resolver: zodResolver(schema), defaultValues: inicial.current });
  const antesDoSemAlvo = useRef<Pick<Valores, "regraTipo" | "exibicao"> | null>(null);
  const faixas = useFieldArray({ control: form.control, name: "faixas" });
  const v = useWatch({ control: form.control }) as Valores;
  const indicador = indicadorDe(v.indicador, v.unidadeLista);
  const avaliacoes = v.indicador === "avaliacoes";
  const regras = regrasPermitidas(v.indicador, v.semAlvo);
  const exibicoes = exibicoesPermitidas(v.semAlvo);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const dados = dadosDe(v);
  const problema = problemaDoFormulario(v, dados);

  useEffect(() => {
    setDirtyCheck(() => JSON.stringify(form.getValues()) !== JSON.stringify(inicial.current));
    return () => setDirtyCheck(null);
  }, [setDirtyCheck, form]);

  /**
   * Ao trocar o Indicador, a unidade da Lista ou o "sem Alvo", leva a regra e a Exibição para uma opção válida. Quando o
   * Sem Alvo desliga, por qualquer motivo, volta a Regra e a Exibição que estavam antes de ligar.
   */
  const ajustar = (indicadorId: IndicadorId, semAlvoPedido: boolean) => {
    const semAlvo = semAlvoPedido && podeSemAlvo(indicadorId, form.getValues("unidadeLista"));
    const estava = form.getValues("semAlvo");
    if (semAlvo && !estava) antesDoSemAlvo.current = { regraTipo: form.getValues("regraTipo"), exibicao: form.getValues("exibicao") };
    if (!semAlvo && estava && antesDoSemAlvo.current) {
      form.setValue("regraTipo", antesDoSemAlvo.current.regraTipo, { shouldDirty: true });
      form.setValue("exibicao", antesDoSemAlvo.current.exibicao, { shouldDirty: true });
      antesDoSemAlvo.current = null;
    }
    if (semAlvo !== estava) form.setValue("semAlvo", semAlvo, { shouldDirty: true });
    const permitidas = regrasPermitidas(indicadorId, semAlvo);
    if (!permitidas.includes(form.getValues("regraTipo"))) form.setValue("regraTipo", permitidas[0]!, { shouldDirty: true });
    const exib = exibicoesPermitidas(semAlvo);
    if (!exib.includes(form.getValues("exibicao"))) form.setValue("exibicao", exib[0]!, { shouldDirty: true });
  };

  const onSubmit = async (valores: Valores) => {
    setTentouSalvar(true);
    const corpo = dadosDe(valores);
    const erro = problemaDoFormulario(valores, corpo);
    if (erro) {
      feedback.notifyError(new Error(erro.mensagem));
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

  /**
   * Com Alvo padrão, o % de Atingimento na unidade do Indicador: com o nome da unidade quando o Indicador tem
   * (ex.: "= 40 incentivos com o Alvo padrão de 50"); senão, "un." nas quantidades (ex.: "= 40 un. com o Alvo padrão de 50 un.").
   */
  const equivalente = (texto: string | undefined): string | null => {
    const pct = numeroOuNull(texto ?? "");
    if (dados.alvoPadrao === null || pct === null || !Number.isFinite(pct) || pct <= 0) return null;
    const valor = valorNoAtingimento(indicador, dados.alvoPadrao, pct);
    return indicador.substantivo
      ? `= ${formatarValor(indicador, valor)} ${indicador.substantivo} com o Alvo padrão de ${formatarValor(indicador, dados.alvoPadrao)}`
      : `= ${comUnidade(indicador, valor)} com o Alvo padrão de ${comUnidade(indicador, dados.alvoPadrao)}`;
  };

  /** O problema que impede salvar, ao lado do campo a que se refere, depois da primeira tentativa de salvar. */
  const erroEm = (campo: CampoDoTipo) =>
    tentouSalvar && problema?.campo === campo ? (
      <Text variant="small" tone="destructive" role="alert">
        {problema.mensagem}
      </Text>
    ) : null;

  const percentualCampo = (name: "gatilho" | "teto" | "percentual", label: string, comEquivalente = false) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <InputGroup>
              <InputGroupInput inputMode="decimal" aria-label={label} {...field} />
              <InputGroupAddon align="inline-end">
                <InputGroupText>%</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          </FormControl>
          {comEquivalente && equivalente(field.value) && <FormDescription>{equivalente(field.value)}</FormDescription>}
          {name === "teto" && erroEm("teto")}
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

  const alvoLabel = avaliacoes ? "Valor inicial (opcional)" : "Alvo padrão (opcional)";

  const nomeCampo = (
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
  );

  const indicadorCampo = (
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
              form.setValue("indicadorBase", baseInicial(id as IndicadorId, form.getValues("unidadeLista")), { shouldDirty: true });
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
          {tipo && <FormDescription>O Indicador não muda depois de cadastrado.</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const semAlvoCampo = podeSemAlvo(v.indicador, v.unidadeLista) && (
    <FormField
      control={form.control}
      name="semAlvo"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Sem Alvo (comissão pura)</FormLabel>
          <FormControl>
            <Switch
              checked={field.value}
              onCheckedChange={(semAlvo: boolean) => ajustar(form.getValues("indicador"), semAlvo)}
              aria-label="Sem Alvo (comissão pura)"
            />
          </FormControl>
          <FormDescription>Paga um percentual do que foi vendido, sem Alvo a atingir.</FormDescription>
          {erroEm("semAlvo")}
        </FormItem>
      )}
    />
  );

  /** No Tipo de Lista, a base pode ser a própria Lista (em R$). */
  const nomeBase = (id: IndicadorId) => (temLista(id) ? "Lista de Produtos deste Tipo de Meta" : indicadorPorId(id)?.nome);

  /** Ao trocar a unidade da Lista, o Alvo padrão recomeça (outra unidade) e o Sem Alvo e a base do Percentual se ajustam. */
  const trocarUnidade = (unidade: UnidadeLista) => {
    form.setValue("unidadeLista", unidade, { shouldDirty: true });
    form.setValue("alvoPadrao", "", { shouldDirty: true });
    const base = form.getValues("indicadorBase");
    const propria = form.getValues("indicador");
    if (unidade === "reais" && base === "") form.setValue("indicadorBase", propria, { shouldDirty: true });
    if (unidade === "unidades" && base === propria) form.setValue("indicadorBase", "", { shouldDirty: true });
    ajustar(form.getValues("indicador"), form.getValues("semAlvo"));
  };

  /** Os Alvos gravados nas Metas estão na unidade da Lista: com Metas, ela não muda (o servidor também recusa). */
  const unidadeFixa = Boolean(tipo?.temMetas);

  const unidadeCampo = temLista(v.indicador) && (
    <FormField
      control={form.control}
      name="unidadeLista"
      render={({ field }) => (
        <FormItem>
          <FormLabel>A Lista mede</FormLabel>
          <Select value={field.value} disabled={unidadeFixa} onValueChange={(u) => u && trocarUnidade(u as UnidadeLista)}>
            <FormControl>
              <SelectTrigger aria-label="A Lista mede">
                <SelectValue>{(u: UnidadeLista) => UNIDADE_LISTA_LABEL[u]}</SelectValue>
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {UNIDADES_LISTA.map((u) => (
                <SelectItem key={u} value={u}>
                  {UNIDADE_LISTA_LABEL[u]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormDescription>
            {unidadeFixa
              ? "A unidade não muda: as Metas deste Tipo de Meta já têm Alvos nela."
              : "Soma tudo o que foi vendido da Lista, com as regras da Venda Líquida; cada produto conta uma vez."}
          </FormDescription>
        </FormItem>
      )}
    />
  );

  const listaCampo = temLista(v.indicador) && (
    <FormField
      control={form.control}
      name="entradas"
      render={({ field }) => (
        <ListaProdutosCampo
          entradas={field.value}
          onChange={field.onChange}
          erro={tentouSalvar && problema?.campo === "lista" ? problema.mensagem : null}
        />
      )}
    />
  );

  const alvoCampo = temAlvoPadrao(v.semAlvo) && (
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
              <InputGroup>
                <InputGroupInput inputMode="decimal" value={String(field.value)} onChange={field.onChange} aria-label={alvoLabel} />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>{indicador.unidade === "percentual" ? "%" : "un."}</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            )}
          </FormControl>
          <FormDescription>
            {avaliacoes ? "Valor com que cada Participante começa o Período." : "Alvo com que cada Participante entra na Meta; dá para mudar por Participante em Montar Metas."}
          </FormDescription>
          {erroEm("alvoPadrao")}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  const exibicaoCampo = (
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
          {erroEm("exibicao")}
        </FormItem>
      )}
    />
  );

  const mostrarPremioCampo = (
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
  );

  const ativoCampo = tipo && (
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
  );

  const regraCampo = (
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
          {erroEm("regra")}
        </FormItem>
      )}
    />
  );

  const faixasCampo = (
    <Stack gap="field">
      <Label>Faixas (% Atingido e Prêmio)</Label>
      {faixas.fields.map((f, i) => (
        <Stack key={f.id} gap="tight">
          <Stack direction="row" gap="field" align="end">
            <FormField
              control={form.control}
              name={`faixas.${i}.atingimento`}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <InputGroup>
                      <InputGroupInput inputMode="decimal" aria-label={`% Atingido da Faixa ${i + 1}`} {...field} />
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>%</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
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
            <Button
              type="button"
              size="icon"
              variant="ghost"
              tone="destructive"
              aria-label={`Remover Faixa ${i + 1}`}
              disabled={faixas.fields.length === 1}
              onClick={() => faixas.remove(i)}
            >
              <Trash2 />
            </Button>
          </Stack>
          {equivalente(v.faixas[i]?.atingimento) && (
            <Text variant="caption" tone="muted">
              {equivalente(v.faixas[i]?.atingimento)}
            </Text>
          )}
        </Stack>
      ))}
      {erroEm("faixas")}
      <Button type="button" variant="outline" onClick={() => faixas.append({ atingimento: "", valor: 0 })}>
        <Plus />
        Adicionar Faixa
      </Button>
    </Stack>
  );

  const percentualCampos = (
    <>
      {percentualCampo("percentual", "Percentual do valor vendido")}
      {!v.semAlvo && (
        <FormField
          control={form.control}
          name="indicadorBase"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Calcular sobre</FormLabel>
              <Select value={field.value} onValueChange={(id) => id && field.onChange(id)}>
                <FormControl>
                  <SelectTrigger aria-label="Calcular sobre">
                    <SelectValue>{(id: IndicadorId | "") => (id ? nomeBase(id) : undefined) ?? "Escolha um Indicador em R$"}</SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {basesPercentual(v.indicador, v.unidadeLista).map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {nomeBase(i.id as IndicadorId)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>O valor vendido no Período sobre o qual o Percentual é calculado.</FormDescription>
              {erroEm("indicadorBase")}
            </FormItem>
          )}
        />
      )}
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
  );

  return (
    <>
      <Form {...form}>
        <form id="tipo-meta-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <Stack gap="section">
            <Grid columns="split">
              <Stack gap="group">
                <Text as="h2" variant="eyebrow" tone="muted">
                  O que mede
                </Text>
                <FieldGroup>
                  {nomeCampo}
                  {indicadorCampo}
                  {semAlvoCampo}
                  {alvoCampo}
                  {unidadeCampo}
                  {listaCampo}
                  {exibicaoCampo}
                  {mostrarPremioCampo}
                  {ativoCampo}
                </FieldGroup>
              </Stack>
              <Stack gap="group">
                <Text as="h2" variant="eyebrow" tone="muted">
                  Como paga
                </Text>
                <FieldGroup>
                  {regraCampo}
                  {v.regraTipo === "fixo" && valorCampo("Prêmio se atingir")}
                  {v.regraTipo === "proporcional" && (
                    <>
                      {valorCampo("Prêmio a 100% atingido")}
                      {percentualCampo("gatilho", "Gatilho (% Atingido, opcional)", true)}
                      {percentualCampo("teto", "Teto (% Atingido, opcional)", true)}
                    </>
                  )}
                  {v.regraTipo === "faixas" && faixasCampo}
                  {v.regraTipo === "percentual" && percentualCampos}
                </FieldGroup>
              </Stack>
            </Grid>
            <Alert variant={problema ? "destructive" : "default"} aria-live="polite">
              <AlertTitle>Prévia do Prêmio</AlertTitle>
              <AlertDescription>{problema?.mensagem ?? descreverPremio(dados)}</AlertDescription>
            </Alert>
          </Stack>
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
