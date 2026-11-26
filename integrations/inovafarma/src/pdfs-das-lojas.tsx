import type { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { CotacaoDownloadsWindow } from "./cotacao-downloads-window";
import { PEDIDOS_BASE } from "./pedido-rascunho-window";

type Ui = ReturnType<typeof useUi>;

/** A janela dos PDFs por Loja fornecedora (o que cada uma deve transferir); vale antes e depois da confirmação. */
export async function abrirPdfsDasLojas({ windows, feedback }: Pick<Ui, "windows" | "feedback">, pedidoId: string, lojas: { codigo: number; nome: string }[], baixar: (nome: string, conteudo: string, tipo: string) => void) {
  await windows.open({
    surface: "dialog",
    size: "large",
    title: "PDFs do Pedido por Loja fornecedora",
    description: "O que cada Loja deve transferir, com uma página por Loja de destino.",
    content: () => (
      <CotacaoDownloadsWindow
        distribuidoras={lojas}
        tipo="PDF"
        semModo
        baixar={async (loja) => {
          try {
            const { nome, conteudo } = await apiFetch<{ nome: string; conteudo: string }>(`${PEDIDOS_BASE}/${pedidoId}/pdf-loja/${loja.codigo}`);
            baixar(nome, conteudo, "application/pdf");
          } catch (err: unknown) {
            feedback.notifyError(err instanceof Error ? err : new Error("Erro ao gerar o PDF."));
          }
        }}
      />
    ),
  });
}
