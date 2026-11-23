import { useState } from "react";
import { Bookmark, Trash2 } from "lucide-react";
import { Button } from "@platform/ui/components/button";
import { Checkbox } from "@platform/ui/components/checkbox";
import { Input } from "@platform/ui/components/input";
import { Label } from "@platform/ui/components/label";
import { Stack, Text } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { API, json } from "./inovafarma-api";
import type { DadosVisaoPedidos, VisaoPedidos } from "./pedidos-visoes";

export const BASE_VISOES = `${API}/pedidos/visoes`;
const NENHUMA = "nenhuma";

/** Os filtros do Lançamento que uma visão guarda (nunca a data). */
export type FiltrosVisao = Omit<DadosVisaoPedidos, "nome" | "padrao">;

const mesmoNome = (a: string, b: string) => a.trim().toLocaleLowerCase("pt-BR") === b.trim().toLocaleLowerCase("pt-BR");

/** Janela "Salvar visão": o nome e "abrir por padrão". Um nome já usado por uma visão do Usuário a atualiza. */
function SalvarVisaoWindow({ filtros, visoes, inicial }: { filtros: FiltrosVisao; visoes: VisaoPedidos[]; inicial?: VisaoPedidos }) {
  const { resolve } = useWindow<VisaoPedidos>();
  const { feedback } = useUi();
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [padrao, setPadrao] = useState(inicial?.padrao ?? false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async () => {
    if (!nome.trim()) {
      setErro("Informe o nome da visão.");
      return;
    }
    const dados: DadosVisaoPedidos = { ...filtros, nome: nome.trim(), padrao };
    const existente = visoes.find((v) => mesmoNome(v.nome, nome));
    try {
      const salva = existente ? await apiFetch<VisaoPedidos>(`${BASE_VISOES}/${existente.id}`, json("PUT", { ...dados, version: existente.version })) : await apiFetch<VisaoPedidos>(BASE_VISOES, json("POST", dados));
      feedback.notify({ type: "success", title: existente ? "Visão atualizada." : "Visão salva." });
      resolve(salva);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao salvar a visão."));
    }
  };

  return (
    <>
      <Stack gap="group">
        <Stack gap="field">
          <Label htmlFor="pedidos-visao-nome">Nome da visão</Label>
          <Input id="pedidos-visao-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Genéricos do Centro" autoComplete="off" />
          {erro && (
            <Text variant="small" tone="destructive" role="alert">
              {erro}
            </Text>
          )}
        </Stack>
        <Stack direction="row" gap="field" align="center">
          <Checkbox id="pedidos-visao-padrao" checked={padrao} onCheckedChange={(v: boolean) => setPadrao(v)} />
          <Label htmlFor="pedidos-visao-padrao">Abrir por padrão</Label>
        </Stack>
      </Stack>
      <WindowActions>
        <WindowCancelButton />
        <Button onClick={() => void salvar()}>Salvar</Button>
      </WindowActions>
    </>
  );
}

interface Props {
  visoes: VisaoPedidos[];
  selecionada: string | null;
  filtros: FiltrosVisao;
  onAplicar: (visao: VisaoPedidos | null) => void;
  /** Depois de salvar ou excluir: recarrega as visões; `salva` é a visão gravada (fica selecionada). */
  onMudou: (salva?: VisaoPedidos) => void;
}

/** Visões salvas do Lançamento: escolher (aplica os filtros), salvar a atual e excluir. */
export function PedidosVisoesBarra({ visoes, selecionada, filtros, onAplicar, onMudou }: Props) {
  const { windows, feedback } = useUi();
  const atual = visoes.find((v) => v.id === selecionada);

  const salvar = async () => {
    const r = await windows.open<VisaoPedidos>({
      surface: "dialog",
      title: "Salvar visão",
      description: "Guarda as Lojas, Filtro de produtos e “apenas com mínimo”. A data não é guardada: ela sempre abre em ontem.",
      content: () => <SalvarVisaoWindow filtros={filtros} visoes={visoes} inicial={atual} />,
    });
    if (r.status === "confirmed") onMudou(r.value);
  };

  const excluir = async () => {
    if (!atual) return;
    const ok = await windows.confirm({ title: "Excluir visão", description: `Excluir a visão "${atual.nome}"?`, confirmLabel: "Excluir", destructive: true });
    if (!ok) return;
    try {
      await apiFetch(`${BASE_VISOES}/${atual.id}?version=${atual.version}`, { method: "DELETE" });
      feedback.notify({ type: "success", title: "Visão excluída." });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao excluir a visão."));
    }
    onAplicar(null);
    onMudou();
  };

  return (
    <Stack direction="row" gap="group" align="end">
      <Stack grow gap="field">
        <Label>Visão</Label>
        <Select value={selecionada ?? NENHUMA} onValueChange={(v) => onAplicar(visoes.find((x) => x.id === v) ?? null)}>
          <SelectTrigger aria-label="Visão">
            <SelectValue>{(v: string) => (v === NENHUMA ? "Nenhuma" : `${visoes.find((x) => x.id === v)?.nome ?? v}${visoes.find((x) => x.id === v)?.padrao ? " (padrão)" : ""}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NENHUMA}>Nenhuma</SelectItem>
            {visoes.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.nome}
                {v.padrao ? " (padrão)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Stack>
      <Button variant="outline" onClick={() => void salvar()}>
        <Bookmark />
        Salvar visão
      </Button>
      {atual && (
        <Button size="icon" variant="ghost" tone="destructive" aria-label={`Excluir a visão ${atual.nome}`} onClick={() => void excluir()}>
          <Trash2 />
        </Button>
      )}
    </Stack>
  );
}
