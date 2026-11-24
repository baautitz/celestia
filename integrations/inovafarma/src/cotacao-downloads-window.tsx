import { useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { Stack, Text } from "@platform/ui/components/layout";
import { ToggleGroup, ToggleGroupItem } from "@platform/ui/components/toggle-group";
import { usePreference } from "@platform/ui/hooks/use-preference";
import { WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";

/** Como o arquivo sai: com as Lojas somadas, ou separado por Loja (seção no PDF, aba extra na planilha). */
export type ModoDownload = "consolidado" | "loja";
const aceita = (v: unknown): v is ModoDownload => v === "consolidado" || v === "loja";

export interface DistribuidoraDownload {
  codigo: number;
  nome: string;
  /** Só nas planilhas: se a distribuidora já devolveu os preços. */
  situacao?: string;
}

/**
 * Modal de download por distribuidora (as planilhas da cotação ou os PDFs do Pedido confirmado): uma linha por
 * distribuidora, com o nome (e a situação) de um lado e o botão do outro, e "Baixar todos" para tirar tudo de uma vez.
 */
export function CotacaoDownloadsWindow({ distribuidoras, tipo, baixar }: { distribuidoras: DistribuidoraDownload[]; tipo: "planilha" | "PDF"; baixar: (d: DistribuidoraDownload, modo: ModoDownload) => Promise<void> }) {
  const [modo, salvarModo] = usePreference<ModoDownload>(`inovafarma:downloads:${tipo.toLowerCase()}:modo`, "consolidado", aceita);
  const [baixando, setBaixando] = useState(false);
  const baixarTodos = async () => {
    setBaixando(true);
    try {
      for (const d of distribuidoras) await baixar(d, modo);
    } finally {
      setBaixando(false);
    }
  };
  return (
    <>
      <Stack gap="group">
        <ToggleGroup variant="outline" spacing={0} value={[modo]} onValueChange={(v: string[]) => { if (aceita(v[0])) salvarModo(v[0]); }} aria-label="Como separar o arquivo">
          <ToggleGroupItem value="consolidado">Consolidado</ToggleGroupItem>
          <ToggleGroupItem value="loja">{tipo === "PDF" ? "Separado por Loja (uma página por Loja)" : "Separado por Loja (uma aba por Loja)"}</ToggleGroupItem>
        </ToggleGroup>
        {distribuidoras.length === 0 ? <Text tone="muted">Nenhuma distribuidora.</Text> : null}
        {distribuidoras.map((d) => (
          <Stack key={d.codigo} direction="row" gap="group" align="center" justify="between">
            <Stack direction="row" gap="group" align="center">
              <Text weight="semibold">{d.nome}</Text>
              {d.situacao ? <Badge variant={d.situacao === "Preços importados" ? "default" : "outline"}>{d.situacao}</Badge> : null}
            </Stack>
            <Button type="button" variant="outline" aria-label={`Baixar ${tipo} de ${d.nome}`} onClick={() => void baixar(d, modo)}>
              <Download /> Baixar {tipo}
            </Button>
          </Stack>
        ))}
      </Stack>
      <WindowActions>
        <WindowCancelButton>Fechar</WindowCancelButton>
        <Button type="button" disabled={baixando || distribuidoras.length === 0} onClick={() => void baixarTodos()}>
          Baixar todos
        </Button>
      </WindowActions>
    </>
  );
}
