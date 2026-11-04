import { Label } from "@platform/ui/components/label";
import { Stack } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { useIsMobile } from "@platform/ui/hooks/use-mobile";
import { usePreference } from "@platform/ui/hooks/use-preference";

export type VisaoMetas = "table" | "by-meta" | "by-colaborador" | "list";

const ROTULO: Record<VisaoMetas, string> = {
  table: "Tabela",
  "by-meta": "Por Meta",
  "by-colaborador": "Por Colaborador",
  list: "Lista",
};

/**
 * Visualização de uma aba das Metas, salva como Preferência do Usuário. A Tabela é a padrão; no celular ela não cabe,
 * então a tela mostra `semTabela` sem apagar a preferência.
 */
export function useVisaoMetas(aba: string, opcoes: readonly VisaoMetas[], semTabela: VisaoMetas) {
  const aceita = (v: unknown): v is VisaoMetas => typeof v === "string" && (opcoes as readonly string[]).includes(v);
  const [salva, salvar] = usePreference<VisaoMetas>(`inovafarma:${aba}:view`, "table", aceita);
  const mobile = useIsMobile();
  const disponiveis = mobile ? opcoes.filter((o) => o !== "table") : opcoes;
  const visao = mobile && salva === "table" ? semTabela : salva;
  return { visao, salvar, disponiveis };
}

export function VisaoSelect({ visao, disponiveis, onChange }: { visao: VisaoMetas; disponiveis: readonly VisaoMetas[]; onChange: (v: VisaoMetas) => void }) {
  return (
    <Stack gap="field">
      <Label>Exibir</Label>
      <Select value={visao} onValueChange={(v) => v && disponiveis.includes(v as VisaoMetas) && onChange(v as VisaoMetas)}>
        <SelectTrigger aria-label="Exibir">
          <SelectValue>{(v: VisaoMetas) => ROTULO[v]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {disponiveis.map((v) => (
            <SelectItem key={v} value={v}>
              {ROTULO[v]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Stack>
  );
}
