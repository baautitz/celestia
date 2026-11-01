import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@platform/ui/components/button";
import { FieldGroup } from "@platform/ui/components/field";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { Input } from "@platform/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { Switch } from "@platform/ui/components/switch";
import { Textarea } from "@platform/ui/components/textarea";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";

export const BASE = "/api/m/inovafarma/furo-estoque";
const MAX_OBSERVACAO = 500;

export interface Motivo {
  id: string;
  nome: string;
  ativo: boolean;
  version: number;
}

export interface Justificativa {
  id: string;
  motivoId: string;
  motivo: string;
  observacao: string | null;
  version: number;
  criadoEm: string;
  justificadoPor: string;
}

const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const schemaJustificativa = z.object({
  motivoId: z.string().min(1, "Selecione o Motivo."),
  observacao: z.string().max(MAX_OBSERVACAO, `A observação deve ter no máximo ${MAX_OBSERVACAO} caracteres.`),
});
type ValoresJustificativa = z.infer<typeof schemaJustificativa>;

interface JustificativaProps {
  periodoId: string;
  codigoMovimento: number;
  motivos: Motivo[];
  /** Presente na edição. */
  justificativa?: Justificativa | null;
}

/** Janela para justificar um Ajuste de Estoque (ou alterar a Justificativa); resolve quando salva. */
export function JustificativaWindow({ periodoId, codigoMovimento, motivos, justificativa }: JustificativaProps) {
  const { resolve } = useWindow<true>();
  const { feedback } = useUi();
  // O Motivo atual fica na lista mesmo desativado; os demais, só os ativos.
  const opcoes = motivos.filter((m) => m.ativo || m.id === justificativa?.motivoId);
  const form = useForm<ValoresJustificativa>({
    resolver: zodResolver(schemaJustificativa),
    defaultValues: { motivoId: justificativa?.motivoId ?? "", observacao: justificativa?.observacao ?? "" },
  });

  const onSubmit = async ({ motivoId, observacao }: ValoresJustificativa) => {
    const corpo = { motivoId, observacao: observacao.trim() || null };
    try {
      if (justificativa) await apiFetch(`${BASE}/justificativas/${justificativa.id}`, json("PUT", { ...corpo, version: justificativa.version }));
      else await apiFetch(`${BASE}/justificativas`, json("POST", { ...corpo, periodoId, codigoMovimento }));
      feedback.notify({ type: "success", title: justificativa ? "Justificativa alterada." : "Ajuste justificado." });
      resolve(true);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao salvar a Justificativa."));
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="justificativa-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <FormField
              control={form.control}
              name="motivoId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger aria-label="Motivo">
                        <SelectValue>{(id: string) => opcoes.find((m) => m.id === id)?.nome ?? "Selecione"}</SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {opcoes.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.nome}
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
              name="observacao"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observação (opcional)</FormLabel>
                  <FormControl>
                    <Textarea maxLength={MAX_OBSERVACAO} rows={4} {...field} />
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
        <Button type="submit" form="justificativa-form" disabled={form.formState.isSubmitting}>
          {justificativa ? "Salvar" : "Justificar"}
        </Button>
      </WindowActions>
    </>
  );
}

const schemaMotivo = z.object({
  nome: z.string().trim().min(1, "Informe o nome do Motivo.").max(80, "O nome do Motivo deve ter no máximo 80 caracteres."),
  ativo: z.boolean(),
});
type ValoresMotivo = z.infer<typeof schemaMotivo>;

/** Janela para cadastrar ou alterar um Motivo do Ajuste; resolve quando salva. */
export function MotivoWindow({ motivo }: { motivo?: Motivo }) {
  const { resolve } = useWindow<true>();
  const { feedback } = useUi();
  const form = useForm<ValoresMotivo>({ resolver: zodResolver(schemaMotivo), defaultValues: { nome: motivo?.nome ?? "", ativo: motivo?.ativo ?? true } });

  const onSubmit = async ({ nome, ativo }: ValoresMotivo) => {
    try {
      if (motivo) await apiFetch(`${BASE}/motivos/${motivo.id}`, json("PUT", { nome: nome.trim(), ativo, version: motivo.version }));
      else await apiFetch(`${BASE}/motivos`, json("POST", { nome: nome.trim() }));
      feedback.notify({ type: "success", title: motivo ? "Motivo alterado." : "Motivo cadastrado." });
      resolve(true);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao salvar o Motivo."));
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="motivo-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
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
            {motivo && (
              <FormField
                control={form.control}
                name="ativo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ativo</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Ativo" />
                    </FormControl>
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
        <Button type="submit" form="motivo-form" disabled={form.formState.isSubmitting}>
          {motivo ? "Salvar" : "Cadastrar"}
        </Button>
      </WindowActions>
    </>
  );
}
