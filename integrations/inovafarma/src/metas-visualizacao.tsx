import { List, Table2, Target, Users } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@platform/ui/components/toggle-group";
import { useIsMobile } from "@platform/ui/hooks/use-mobile";
import { usePreference } from "@platform/ui/hooks/use-preference";

export type VisaoMetas = "table" | "by-meta" | "by-colaborador" | "list";

const ICONE: Record<VisaoMetas, typeof Table2> = { table: Table2, "by-meta": Target, "by-colaborador": Users, list: List };

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

/** Seletor da visualização em abas com ícone, ao lado dos filtros. */
export function VisaoSelect({ visao, disponiveis, onChange }: { visao: VisaoMetas; disponiveis: readonly VisaoMetas[]; onChange: (v: VisaoMetas) => void }) {
  return (
    <ToggleGroup
      variant="outline"
      spacing={0}
      aria-label="Visualização das Metas"
      value={[visao]}
      onValueChange={(v: string[]) => {
        const escolhida = v[0] as VisaoMetas | undefined;
        if (escolhida && disponiveis.includes(escolhida)) onChange(escolhida);
      }}
    >
      {disponiveis.map((v) => {
        const Icone = ICONE[v];
        return (
          <ToggleGroupItem key={v} value={v} aria-label={ROTULO[v]}>
            <Icone />
            {ROTULO[v]}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
