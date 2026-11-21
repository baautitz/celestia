import { useState } from "react";
import { Button } from "@platform/ui/components/button";
import { Input } from "@platform/ui/components/input";
import { Stack, Text } from "@platform/ui/components/layout";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { API, json } from "./inovafarma-api";
import type { LojaOpcao } from "./loja-opcao";

export const PEDIDOS_BASE = `${API}/pedidos/pedidos`;

export interface ItemPedido {
  produtoId: string;
  nome: string;
  codigoBarra: string | null;
  quantidades: { codigoLoja: number; quantidade: number }[];
}

export interface Pedido {
  id: string;
  status: "rascunho" | "aguardando_precos" | "cotado" | "cancelado";
  itens: ItemPedido[];
  criadoPorNome: string;
  version: number;
  criadoEm: string;
}

interface Props {
  itens: ItemPedido[];
  lojas: LojaOpcao[];
  /** Presente na edição: o rascunho e a versão que o servidor confere. */
  pedido?: Pedido;
}

const nomeLoja = (lojas: LojaOpcao[], codigo: number) => lojas.find((l) => l.codigo === codigo)?.nome || `Loja ${codigo}`;

/** Janela do Pedido em rascunho (gerar ou editar): a quantidade digitada de cada produto por Loja. */
export function PedidoRascunhoWindow({ itens, lojas, pedido }: Props) {
  const { resolve } = useWindow<Pedido>();
  const { feedback } = useUi();
  const [digitado, setDigitado] = useState<Record<string, string>>(() =>
    Object.fromEntries(itens.flatMap((i) => i.quantidades.map((q) => [`${i.produtoId}:${q.codigoLoja}`, String(q.quantidade)]))),
  );
  const [enviando, setEnviando] = useState(false);

  const salvar = async () => {
    const dados = {
      itens: itens.map((i) => ({ ...i, quantidades: i.quantidades.map((q) => ({ codigoLoja: q.codigoLoja, quantidade: Number(digitado[`${i.produtoId}:${q.codigoLoja}`] || 0) })) })),
    };
    setEnviando(true);
    try {
      const salvo = pedido
        ? await apiFetch<Pedido>(`${PEDIDOS_BASE}/${pedido.id}`, json("PUT", { ...dados, version: pedido.version }))
        : await apiFetch<Pedido>(PEDIDOS_BASE, json("POST", dados));
      feedback.notify({ type: "success", title: pedido ? "Rascunho salvo." : "Pedido gerado em rascunho." });
      resolve(salvo);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao salvar o Pedido."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <Stack gap="section">
        {itens.map((i) => (
          <Stack key={i.produtoId} gap="field">
            <Text variant="small">{i.nome}</Text>
            <Stack direction="row" gap="group" wrap>
              {i.quantidades.map((q) => {
                const rotulo = `${i.nome}: ${nomeLoja(lojas, q.codigoLoja)}`;
                const chave = `${i.produtoId}:${q.codigoLoja}`;
                return (
                  <Stack key={chave} gap="field">
                    <Text variant="caption" tone="muted">
                      {nomeLoja(lojas, q.codigoLoja)}
                    </Text>
                    <Input type="number" inputMode="numeric" min={0} step={1} aria-label={rotulo} value={digitado[chave] ?? ""} onChange={(e) => setDigitado((d) => ({ ...d, [chave]: e.target.value }))} />
                  </Stack>
                );
              })}
            </Stack>
          </Stack>
        ))}
      </Stack>
      <WindowActions>
        <WindowCancelButton>Cancelar</WindowCancelButton>
        <Button type="button" disabled={enviando} onClick={() => void salvar()}>
          {pedido ? "Salvar rascunho" : "Gerar rascunho"}
        </Button>
      </WindowActions>
    </>
  );
}
