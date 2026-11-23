import { useCallback, useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { Input } from "@platform/ui/components/input";
import { Stack, Text } from "@platform/ui/components/layout";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { json } from "./inovafarma-api";
import type { LojaOpcao } from "./loja-opcao";
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
  pedido: { id: string; status: string; version: number; escolhas: Record<string, number> };
  podeConfirmar: boolean;
  fornecedores: FornecedorCotacao[];
  produtos: ProdutoCotacao[];
}

interface Previa {
  validas: number;
  semOferta: number;
  erros: { linha: number; mensagem: string }[];
  semMatch: { linha: number }[];
}

interface LinhaConferida {
  produtoId: string;
  nome: string;
  codigoLoja: number;
  pedida: number;
  recebida: number;
  estado: "pendente" | "parcial" | "recebido" | "excedente";
}

const ESTADOS = { pendente: "Pendente", parcial: "Parcial", recebido: "Recebido", excedente: "Excedente" } as const;
const CONFIRMADOS = ["confirmado", "parcialmente_recebido", "recebido"];

const preco = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

async function emBase64(arquivo: File): Promise<string> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  let texto = "";
  for (let i = 0; i < bytes.length; i += 0x8000) texto += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(texto);
}

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function baixar(nome: string, conteudoBase64: string, tipo = XLSX): void {
  const bytes = Uint8Array.from(atob(conteudoBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
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

/** Fornecedor de menor preço por produto; produto sem oferta fica sem escolha. */
function menorPreco(detalhe: DetalheCotacao): Record<string, number> {
  const escolhas: Record<string, number> = {};
  for (const p of detalhe.produtos) {
    let melhor: { codigo: number; valor: number } | null = null;
    for (const f of detalhe.fornecedores) {
      const valor = p.precos[f.codigo];
      if (valor !== null && valor !== undefined && (!melhor || valor < melhor.valor)) melhor = { codigo: f.codigo, valor };
    }
    if (melhor) escolhas[p.produtoId] = melhor.codigo;
  }
  return escolhas;
}

/** Cotação do Pedido: a planilha de cada fornecedor (baixar, importar com prévia) e a comparação de preços. */
export function CotacaoWindow({ pedidoId, lojas = [] }: { pedidoId: string; lojas?: LojaOpcao[] }) {
  const { windows, feedback } = useUi();
  const base = `${PEDIDOS_BASE}/${pedidoId}/cotacao`;
  const [detalhe, setDetalhe] = useState<DetalheCotacao | null>(null);
  /** Trocas do usuário sobre a escolha padrão (menor preço). */
  const [trocas, setTrocas] = useState<Record<string, number>>({});
  const [linhas, setLinhas] = useState<LinhaConferida[] | null>(null);

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
        await windows.open({ surface: "dialog", size: "medium", title: `Planilha de ${f.nome}`, content: () => <ErrosDaPrevia erros={previa.erros} /> });
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

  const baixarPdf = async (f: FornecedorCotacao) => {
    try {
      const { nome, conteudo } = await apiFetch<{ nome: string; conteudo: string }>(`${PEDIDOS_BASE}/${pedidoId}/pdf/${f.codigo}`);
      baixar(nome, conteudo, "application/pdf");
    } catch (err: unknown) {
      erro(err, "Erro ao gerar o PDF.");
    }
  };

  const conferirNf = async () => {
    try {
      const { linhas: conferidas } = await apiFetch<{ linhas: LinhaConferida[] }>(`${PEDIDOS_BASE}/${pedidoId}/conferir`, json("POST", {}));
      setLinhas(conferidas);
      setDetalhe(await apiFetch<DetalheCotacao>(base));
    } catch (err: unknown) {
      erro(err, "Erro ao conferir com a NF.");
    }
  };

  if (!detalhe) return <Text tone="muted">Carregando a cotação...</Text>;

  const confirmado = CONFIRMADOS.includes(detalhe.pedido.status);
  const editavel = detalhe.pedido.status === "cotado" && detalhe.podeConfirmar;
  /** Menor preço por produto (o primeiro fornecedor da lista em empate), trocável pelo usuário. */
  const escolhas: Record<string, number> = confirmado ? detalhe.pedido.escolhas : { ...menorPreco(detalhe), ...trocas };

  const confirmarPedido = async () => {
    const ok = await windows.confirm({ title: "Confirmar Pedido", description: "Confirmar o Pedido com os fornecedores escolhidos? Depois de confirmado a escolha não muda.", confirmLabel: "Confirmar Pedido" });
    if (!ok) return;
    try {
      await apiFetch(`${PEDIDOS_BASE}/${pedidoId}/confirmar`, json("POST", { escolhas, version: detalhe.pedido.version }));
      feedback.notify({ type: "success", title: "Pedido confirmado." });
    } catch (err: unknown) {
      erro(err, "Erro ao confirmar o Pedido.");
    }
    setDetalhe(await apiFetch<DetalheCotacao>(base).catch(() => detalhe));
  };
  const nomeLoja = (codigo: number) => lojas.find((l) => l.codigo === codigo)?.nome ?? `Loja ${codigo}`;

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
          const valor = v === menor ? <Text weight="bold" tone="success" title="Menor preço">{preco(v)}</Text> : <Text>{preco(v)}</Text>;
          if (!editavel) return confirmado && escolhas[p.produtoId] === f.codigo ? <Badge>{preco(v)}</Badge> : valor;
          const escolhido = escolhas[p.produtoId] === f.codigo;
          return (
            <Button type="button" variant={escolhido ? "default" : "outline"} aria-pressed={escolhido} aria-label={`Escolher ${f.nome} para ${p.nome}`} onClick={() => setTrocas((t) => ({ ...t, [p.produtoId]: f.codigo }))}>
              {/* No botão escolhido (fundo escuro) o texto herda a cor do botão: o verde do menor preço não tem contraste. */}
              {escolhido ? <Text title={v === menor ? "Menor preço" : undefined}>{preco(v)}</Text> : valor}
            </Button>
          );
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
        {confirmado ? (
          <Stack direction="row" gap="group" wrap>
            {detalhe.fornecedores
              .filter((f) => Object.values(escolhas).includes(f.codigo))
              .map((f) => (
                <Button key={f.codigo} type="button" variant="outline" aria-label={`Baixar PDF de ${f.nome}`} onClick={() => void baixarPdf(f)}>
                  <FileText /> Baixar PDF
                </Button>
              ))}
            <Button type="button" onClick={() => void conferirNf()}>Conferir NF</Button>
          </Stack>
        ) : null}
        {linhas ? (
          <DataTable
            title="Conferência com a NF"
            columns={[
              { key: "nome", label: "Produto", value: (l: LinhaConferida) => l.nome, searchable: true, mobileRole: "primary" },
              { key: "loja", label: "Loja", value: (l: LinhaConferida) => nomeLoja(l.codigoLoja) },
              { key: "pedida", label: "Pedida", format: "decimal", value: (l: LinhaConferida) => l.pedida },
              { key: "recebida", label: "Recebida", format: "decimal", value: (l: LinhaConferida) => l.recebida },
              { key: "estado", label: "Situação", value: (l: LinhaConferida) => ESTADOS[l.estado] },
            ]}
            rows={linhas}
            getRowId={(l) => `${l.produtoId}|${l.codigoLoja}`}
            emptyMessage="Nenhum produto para conferir."
          />
        ) : null}
        <DataTable title="Comparação de preços" columns={colunas} rows={detalhe.produtos} getRowId={(p) => p.produtoId} emptyMessage="Nenhum produto no Pedido." search={{ placeholder: "Buscar produto" }} />
      </Stack>
      <WindowActions>
        <WindowCancelButton>Fechar</WindowCancelButton>
        {editavel ? <Button type="button" onClick={() => void confirmarPedido()}>Confirmar Pedido</Button> : null}
      </WindowActions>
    </>
  );
}
