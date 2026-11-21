import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { Input } from "@platform/ui/components/input";
import { Stack, Text } from "@platform/ui/components/layout";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { json } from "./inovafarma-api";
import { PEDIDOS_BASE } from "./pedido-rascunho-window";

interface FornecedorCotacao {
  codigo: number;
  nome: string;
  importado: boolean;
  version: number;
}

interface ProdutoCotacao {
  produtoId: string;
  nome: string;
  quantidade: number;
  /** Código do fornecedor -> preço; null = sem oferta. */
  precos: Record<string, number | null>;
}

interface DetalheCotacao {
  fornecedores: FornecedorCotacao[];
  produtos: ProdutoCotacao[];
}

interface Previa {
  validas: number;
  semOferta: number;
  erros: { linha: number; mensagem: string }[];
  semMatch: { linha: number }[];
}

const preco = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

async function emBase64(arquivo: File): Promise<string> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  let texto = "";
  for (let i = 0; i < bytes.length; i += 0x8000) texto += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(texto);
}

function baixar(nome: string, conteudoBase64: string): void {
  const bytes = Uint8Array.from(atob(conteudoBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}

function ErrosDaPrevia({ erros }: { erros: Previa["erros"] }) {
  return (
    <>
      <Stack gap="field">
        <Text>A planilha tem linhas com erro e nada foi importado. Corrija e envie de novo.</Text>
        {erros.map((e) => (
          <Text key={e.linha} tone="muted">{`Linha ${e.linha}: ${e.mensagem}`}</Text>
        ))}
      </Stack>
      <WindowActions>
        <WindowCancelButton>Fechar</WindowCancelButton>
      </WindowActions>
    </>
  );
}

/** Cotação do Pedido: a planilha de cada fornecedor (baixar, importar com prévia) e a comparação de preços. */
export function CotacaoWindow({ pedidoId }: { pedidoId: string }) {
  const { windows, feedback } = useUi();
  const base = `${PEDIDOS_BASE}/${pedidoId}/cotacao`;
  const [detalhe, setDetalhe] = useState<DetalheCotacao | null>(null);

  const erro = useCallback((err: unknown, padrao: string) => feedback.notifyError(err instanceof Error ? err : new Error(padrao)), [feedback]);

  useEffect(() => {
    apiFetch<DetalheCotacao>(base)
      .then(setDetalhe)
      .catch((err: unknown) => erro(err, "Erro ao carregar a cotação."));
  }, [base, erro]);

  const baixarPlanilha = async (f: FornecedorCotacao) => {
    try {
      const { nome, conteudo } = await apiFetch<{ nome: string; conteudo: string }>(`${base}/${f.codigo}/planilha`);
      baixar(nome, conteudo);
    } catch (err: unknown) {
      erro(err, "Erro ao gerar a planilha.");
    }
  };

  const importar = async (f: FornecedorCotacao, arquivo: File) => {
    try {
      const conteudo = await emBase64(arquivo);
      const previa = await apiFetch<Previa>(`${base}/${f.codigo}/previa`, json("POST", { arquivo: conteudo }));
      if (previa.erros.length > 0) {
        await windows.open({ surface: "dialog", size: "default", title: `Planilha de ${f.nome}`, content: () => <ErrosDaPrevia erros={previa.erros} /> });
        return;
      }
      const resumo = [plural(previa.validas, "preço válido", "preços válidos"), plural(previa.semOferta, "linha sem oferta", "linhas sem oferta")];
      if (previa.semMatch.length > 0) resumo.push(`${plural(previa.semMatch.length, "linha ignorada", "linhas ignoradas")} (produto fora do Pedido)`);
      const ok = await windows.confirm({ title: `Importar a planilha de ${f.nome}`, description: `${resumo.join(", ")}.`, confirmLabel: "Importar preços" });
      if (!ok) return;
      setDetalhe(await apiFetch<DetalheCotacao>(`${base}/${f.codigo}/importar`, json("POST", { arquivo: conteudo, version: f.version })));
      feedback.notify({ type: "success", title: "Preços importados." });
    } catch (err: unknown) {
      erro(err, "Erro ao importar a planilha.");
      void apiFetch<DetalheCotacao>(base).then(setDetalhe).catch(() => undefined);
    }
  };

  if (!detalhe) return <Text tone="muted">Carregando a cotação...</Text>;

  const colunas: DataTableColumn<ProdutoCotacao>[] = [
    { key: "nome", label: "Produto", value: (p) => p.nome, searchable: true, mobileRole: "primary" },
    { key: "quantidade", label: "Quantidade", format: "decimal", value: (p) => p.quantidade },
    ...detalhe.fornecedores.map(
      (f): DataTableColumn<ProdutoCotacao> => ({
        key: `f${f.codigo}`,
        label: f.nome,
        render: (p) => {
          const v = p.precos[f.codigo];
          if (v === null || v === undefined) return <Text tone="muted">{f.importado ? "Sem oferta" : "-"}</Text>;
          const menor = Math.min(...Object.values(p.precos).filter((x): x is number => x !== null));
          return v === menor ? <Text weight="bold" tone="success" title="Menor preço">{preco(v)}</Text> : <Text>{preco(v)}</Text>;
        },
      }),
    ),
  ];

  return (
    <>
      <Stack gap="section">
        {detalhe.fornecedores.map((f) => (
          <Stack key={f.codigo} direction="row" gap="group" wrap>
            <Text>{f.nome}</Text>
            <Badge variant={f.importado ? "default" : "outline"}>{f.importado ? "Preços importados" : "Aguardando preços"}</Badge>
            <Button type="button" variant="outline" aria-label={`Baixar planilha de ${f.nome}`} onClick={() => void baixarPlanilha(f)}>
              <Download /> Baixar planilha
            </Button>
            <Input
              type="file"
              accept=".xlsx"
              aria-label={`Planilha preenchida de ${f.nome}`}
              onChange={(e) => {
                const arquivo = e.target.files?.[0];
                e.target.value = "";
                if (arquivo) void importar(f, arquivo);
              }}
            />
          </Stack>
        ))}
        <DataTable title="Comparação de preços" columns={colunas} rows={detalhe.produtos} getRowId={(p) => p.produtoId} emptyMessage="Nenhum produto no Pedido." search={{ placeholder: "Buscar produto" }} />
      </Stack>
      <WindowActions>
        <WindowCancelButton>Fechar</WindowCancelButton>
      </WindowActions>
    </>
  );
}
