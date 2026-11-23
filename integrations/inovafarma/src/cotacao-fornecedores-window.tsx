import { useEffect, useState } from "react";
import { Button } from "@platform/ui/components/button";
import { Checkbox } from "@platform/ui/components/checkbox";
import { Input } from "@platform/ui/components/input";
import { Label } from "@platform/ui/components/label";
import { Stack, Text } from "@platform/ui/components/layout";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { json } from "./inovafarma-api";
import { PEDIDOS_BASE, type Pedido } from "./pedido-rascunho-window";
import { useLatestFetch } from "./use-latest-fetch";
import { API } from "./inovafarma-api";

interface FornecedorErp {
  codigo: number;
  nome: string;
}

/** Janela de escolha dos fornecedores que participam da cotação do rascunho. */
export function CotacaoFornecedoresWindow({ pedido }: { pedido: Pedido }) {
  const { resolve } = useWindow<true>();
  const { feedback } = useUi();
  const novaConsulta = useLatestFetch();
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<FornecedorErp[]>([]);
  const [escolhidos, setEscolhidos] = useState<Map<number, string>>(
    // Começa com as distribuidoras escolhidas nas linhas do Pedido (o nome vem da lista do ERP).
    () => new Map(pedido.itens.flatMap((i) => i.quantidades.flatMap((q) => (q.codigoFornecedor ? [[q.codigoFornecedor, `Distribuidora ${q.codigoFornecedor}`] as const] : [])))),
  );
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const vale = novaConsulta();
    apiFetch<FornecedorErp[]>(`${API}/pedidos/fornecedores?busca=${encodeURIComponent(busca.trim())}`)
      .then((r) => {
        if (!vale()) return;
        setLista(r);
        // Troca o nome provisório das pré-escolhidas pelo nome do ERP.
        setEscolhidos((atual) => new Map([...atual].map(([codigo, nome]) => [codigo, r.find((f) => f.codigo === codigo)?.nome ?? nome])));
      })
      .catch((err: unknown) => vale() && feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar os fornecedores.")));
  }, [busca, novaConsulta, feedback]);

  const alternar = (f: FornecedorErp, marcado: boolean) =>
    setEscolhidos((atual) => {
      const novo = new Map(atual);
      if (marcado) novo.set(f.codigo, f.nome);
      else novo.delete(f.codigo);
      return novo;
    });

  const iniciar = async () => {
    setEnviando(true);
    try {
      await apiFetch(`${PEDIDOS_BASE}/${pedido.id}/cotacao`, json("POST", { fornecedores: [...escolhidos.keys()], version: pedido.version }));
      feedback.notify({ type: "success", title: "Cotação iniciada. Baixe a planilha de cada fornecedor." });
      resolve(true);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao iniciar a cotação."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <Stack gap="section">
        {escolhidos.size > 0 && (
          <Stack gap="field">
            <Text variant="caption" tone="muted">
              Escolhidos
            </Text>
            {[...escolhidos].map(([codigo, nome]) => (
              <Stack key={codigo} direction="row" gap="field">
                <Checkbox aria-label={`Escolhido ${nome}`} checked onCheckedChange={() => alternar({ codigo, nome }, false)} />
                <Text>{nome}</Text>
              </Stack>
            ))}
          </Stack>
        )}
        <Stack gap="field">
          <Label htmlFor="cotacao-busca-fornecedor">Buscar fornecedor</Label>
          <Input id="cotacao-busca-fornecedor" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </Stack>
        <Stack gap="field">
          {lista.length === 0 && <Text tone="muted">Nenhum fornecedor encontrado.</Text>}
          {lista.map((f) => (
            <Stack key={f.codigo} direction="row" gap="field">
              <Checkbox aria-label={`Selecionar ${f.nome}`} checked={escolhidos.has(f.codigo)} onCheckedChange={(v: boolean) => alternar(f, v)} />
              <Text>{f.nome}</Text>
            </Stack>
          ))}
        </Stack>
        <Text variant="caption" tone="muted">
          {escolhidos.size} {escolhidos.size === 1 ? "fornecedor escolhido" : "fornecedores escolhidos"}
        </Text>
      </Stack>
      <WindowActions>
        <WindowCancelButton>Cancelar</WindowCancelButton>
        <Button type="button" disabled={enviando || escolhidos.size === 0} onClick={() => void iniciar()}>
          Iniciar cotação
        </Button>
      </WindowActions>
    </>
  );
}
