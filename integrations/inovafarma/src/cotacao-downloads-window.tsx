import { useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { Stack, Text } from "@platform/ui/components/layout";
import { WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";

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
export function CotacaoDownloadsWindow({ distribuidoras, tipo, baixar }: { distribuidoras: DistribuidoraDownload[]; tipo: "planilha" | "PDF"; baixar: (d: DistribuidoraDownload) => Promise<void> }) {
  const [baixando, setBaixando] = useState(false);
  const baixarTodos = async () => {
    setBaixando(true);
    try {
      for (const d of distribuidoras) await baixar(d);
    } finally {
      setBaixando(false);
    }
  };
  return (
    <>
      <Stack gap="group">
        {distribuidoras.length === 0 ? <Text tone="muted">Nenhuma distribuidora.</Text> : null}
        {distribuidoras.map((d) => (
          <Stack key={d.codigo} direction="row" gap="group" align="center" justify="between">
            <Stack direction="row" gap="group" align="center">
              <Text weight="semibold">{d.nome}</Text>
              {d.situacao ? <Badge variant={d.situacao === "Preços importados" ? "default" : "outline"}>{d.situacao}</Badge> : null}
            </Stack>
            <Button type="button" variant="outline" aria-label={`Baixar ${tipo} de ${d.nome}`} onClick={() => void baixar(d)}>
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
