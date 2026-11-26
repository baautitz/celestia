import { useState, type FormEvent } from "react";
import { Button } from "@platform/ui/components/button";
import { DatePicker } from "@platform/ui/components/date-picker";
import { FieldGroup } from "@platform/ui/components/field";
import { Label } from "@platform/ui/components/label";
import { Grid, Stack, Text } from "@platform/ui/components/layout";
import { MoneyInput } from "@platform/ui/components/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { json } from "./inovafarma-api";
import type { LojaOpcao } from "./loja-opcao";
import { LIMITES_BASE, nomeDaLoja } from "./pedidos-limites-comum";
import { DadosValorLimite, type RegraLimite, type ValorLimite } from "./pedidos-limites";

const TIPOS = { todas: "Todas as Lojas", porLoja: "Por Loja" } as const;
type Tipo = keyof typeof TIPOS;

const paraDia = (iso: string) => (iso ? new Date(`${iso}T00:00:00`) : undefined);
const paraIso = (d: Date | undefined) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "");
const centavos = (reais: number) => Math.round(reais * 100);

/** Janela de lançar ou editar o Valor do Limite. */
export function ValorLimiteWindow({ valor, regras, lojas }: { valor?: ValorLimite; regras: RegraLimite[]; lojas: LojaOpcao[] }) {
  const { resolve } = useWindow<ValorLimite>();
  const { feedback } = useUi();
  const anterior = valor?.distribuicao;
  const [regraId, setRegraId] = useState(valor?.regraId ?? (regras.length === 1 ? (regras[0]?.id ?? "") : ""));
  const [inicio, setInicio] = useState(valor?.inicio ?? "");
  const [fim, setFim] = useState(valor?.fim ?? "");
  const [tipo, setTipo] = useState<Tipo>(anterior?.tipo ?? "todas");
  const [total, setTotal] = useState(anterior?.tipo === "todas" ? anterior.valorCentavos / 100 : 0);
  const [porLoja, setPorLoja] = useState<Record<number, number>>(anterior?.tipo === "porLoja" ? Object.fromEntries(anterior.lojas.map((l) => [l.codigoLoja, l.valorCentavos / 100])) : {});
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // A Loja que sumiu do ERP continua editável enquanto o Valor a tiver.
  const codigos = [...new Set([...lojas.map((l) => l.codigo), ...(anterior?.tipo === "porLoja" ? anterior.lojas.map((l) => l.codigoLoja) : [])])];

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    const distribuicao =
      tipo === "todas"
        ? { tipo, valorCentavos: centavos(total) }
        : { tipo, lojas: codigos.filter((c) => (porLoja[c] ?? 0) > 0).map((c) => ({ codigoLoja: c, valorCentavos: centavos(porLoja[c] ?? 0) })) };
    const lido = DadosValorLimite.safeParse({ regraId, inicio, fim, distribuicao });
    if (!lido.success) {
      setErro(lido.error.issues[0]?.message ?? "Confira os campos.");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const salvo = valor
        ? await apiFetch<ValorLimite>(`${LIMITES_BASE}/valores/${valor.id}`, json("PUT", { ...lido.data, version: valor.version }))
        : await apiFetch<ValorLimite>(`${LIMITES_BASE}/valores`, json("POST", lido.data));
      feedback.notify({ type: "success", title: valor ? "Valor do Limite alterado." : "Valor do Limite lançado." });
      resolve(salvo);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao salvar o Valor do Limite."));
      setSalvando(false);
    }
  };

  return (
    <>
      <form id="valor-limite-form" noValidate onSubmit={(e) => void salvar(e)}>
        <FieldGroup>
          <Stack gap="field">
            <Label htmlFor="valor-limite-regra">Regra</Label>
            <Select value={regraId || null} onValueChange={(v) => v && setRegraId(v)}>
              <SelectTrigger id="valor-limite-regra">
                <SelectValue>{(id: string | null) => regras.find((r) => r.id === id)?.nome ?? "Escolha a Regra"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {regras.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Stack>
          <Grid columns={2}>
            <Stack gap="field">
              <Label>Início</Label>
              <DatePicker value={paraDia(inicio)} onChange={(d) => setInicio(paraIso(d))} />
            </Stack>
            <Stack gap="field">
              <Label>Fim</Label>
              <DatePicker value={paraDia(fim)} onChange={(d) => setFim(paraIso(d))} />
            </Stack>
          </Grid>
          <Stack gap="field">
            <Label htmlFor="valor-limite-tipo">Vale para</Label>
            <Select value={tipo} onValueChange={(v) => v && setTipo(v as Tipo)}>
              <SelectTrigger id="valor-limite-tipo">
                <SelectValue>{(t: Tipo) => TIPOS[t]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">{TIPOS.todas}</SelectItem>
                <SelectItem value="porLoja">{TIPOS.porLoja}</SelectItem>
              </SelectContent>
            </Select>
          </Stack>
          {tipo === "todas" ? (
            <Stack gap="field">
              <Label htmlFor="valor-limite-total">Valor</Label>
              <MoneyInput id="valor-limite-total" value={total || null} onValueChange={setTotal} />
            </Stack>
          ) : (
            <Stack gap="group">
              <Text variant="small" tone="muted">
                Loja em branco fica sem limite.
              </Text>
              {codigos.map((c) => (
                <Stack key={c} gap="field">
                  <Label htmlFor={`valor-limite-loja-${c}`}>{nomeDaLoja(lojas, c)}</Label>
                  <MoneyInput id={`valor-limite-loja-${c}`} value={porLoja[c] || null} onValueChange={(v) => setPorLoja((atual) => ({ ...atual, [c]: v }))} />
                </Stack>
              ))}
            </Stack>
          )}
          {erro && (
            <Text variant="small" tone="destructive" role="alert">
              {erro}
            </Text>
          )}
        </FieldGroup>
      </form>
      <WindowActions>
        <WindowCancelButton />
        <Button type="submit" form="valor-limite-form" disabled={salvando}>
          {valor ? "Salvar" : "Lançar"}
        </Button>
      </WindowActions>
    </>
  );
}
