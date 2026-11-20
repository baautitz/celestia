import { useMemo, useState } from "react";
import { Button } from "@platform/ui/components/button";
import { Input } from "@platform/ui/components/input";
import { Stack, Text } from "@platform/ui/components/layout";
import { Switch } from "@platform/ui/components/switch";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import type { LojaOpcao } from "./loja-opcao";

/** Escolha das Lojas de um Colaborador: uma chave por Loja. Resolve com os códigos marcados, em ordem. */
export function LojasColaboradorWindow({ opcoes, lojas }: { opcoes: LojaOpcao[]; lojas: number[] }) {
  const { resolve } = useWindow<number[]>();
  const [marcadas, setMarcadas] = useState<ReadonlySet<number>>(() => new Set(lojas));
  const [busca, setBusca] = useState("");
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return termo ? opcoes.filter((o) => o.nome.toLocaleLowerCase("pt-BR").includes(termo)) : opcoes;
  }, [opcoes, busca]);
  const alternar = (codigo: number, ligada: boolean) =>
    setMarcadas((atual) => {
      const proxima = new Set(atual);
      if (ligada) proxima.add(codigo);
      else proxima.delete(codigo);
      return proxima;
    });
  const definirVisiveis = (ligada: boolean) =>
    setMarcadas((atual) => {
      const proxima = new Set(atual);
      for (const o of visiveis) {
        if (ligada) proxima.add(o.codigo);
        else proxima.delete(o.codigo);
      }
      return proxima;
    });

  return (
    <>
      <Stack gap="group">
        {opcoes.length > 8 && <Input aria-label="Buscar Loja" placeholder="Buscar Loja" value={busca} onChange={(e) => setBusca(e.target.value)} />}
        <Stack direction="row" align="center" justify="between" gap="group">
          <Text variant="caption" tone="muted">
            {marcadas.size} de {opcoes.length} selecionadas
          </Text>
          <Stack direction="row" gap="field">
            <Button type="button" variant="outline" onClick={() => definirVisiveis(true)}>
              Marcar todas
            </Button>
            <Button type="button" variant="outline" onClick={() => definirVisiveis(false)}>
              Limpar
            </Button>
          </Stack>
        </Stack>
        <Stack gap="field">
          {visiveis.map((o) => (
            <Stack key={o.codigo} direction="row" align="center" justify="between" gap="group" surface="card">
              <Text variant="small">{o.nome}</Text>
              <Switch aria-label={o.nome} checked={marcadas.has(o.codigo)} onCheckedChange={(ligada) => alternar(o.codigo, ligada)} />
            </Stack>
          ))}
          {visiveis.length === 0 && (
            <Text variant="small" tone="muted">
              Nenhuma Loja encontrada.
            </Text>
          )}
        </Stack>
      </Stack>
      <WindowActions>
        <WindowCancelButton />
        <Button type="button" onClick={() => resolve([...marcadas].sort((a, b) => a - b))}>
          Aplicar
        </Button>
      </WindowActions>
    </>
  );
}
