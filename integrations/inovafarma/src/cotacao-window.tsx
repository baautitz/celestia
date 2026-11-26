import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Upload } from "lucide-react";
import { Button } from "@platform/ui/components/button";
import { Input } from "@platform/ui/components/input";
import { Stack, Text } from "@platform/ui/components/layout";
import { DataTable } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { abrirPdfsDasLojas } from "./pdfs-das-lojas";
import { CotacaoComparacao, marcadosDa, parcelasDe, type Marcados, type ProdutoCotacao } from "./cotacao-comparacao";
import type { Escolha, Escolhas } from "./pedidos";
import { CotacaoDownloadsWindow, type ModoDownload } from "./cotacao-downloads-window";
import { json } from "./inovafarma-api";
import type { LojaOpcao } from "./loja-opcao";
import { PEDIDOS_BASE } from "./pedido-rascunho-window";

interface FornecedorCotacao {
  codigo: number;
  nome: string;
  importado: boolean;
  version: number;
}

interface DetalheCotacao {
  pedido: { id: string; status: string; version: number; escolhas: Escolhas };
  podeConfirmar: boolean;
  /** Lojas que fornecem parte do Pedido, por transferência. */
  lojasFornecedoras?: number[];
  fornecedores: FornecedorCotacao[];
  produtos: ProdutoCotacao[];
}

interface Previa {
  validas: number;
  semOferta: number;
  quantidadesDiferentes: number;
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

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

async function emBase64(arquivo: File): Promise<string> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  let texto = "";
  for (let i = 0; i < bytes.length; i += 0x8000) texto += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(texto);
}

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function baixar(nome: string, conteudoBase64: string, tipo = XLSX): void {
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

const fornecedoresDe = (escolha: Escolha | undefined): number[] => (escolha === undefined ? [] : typeof escolha === "number" ? [escolha] : [...new Set(escolha.map((p) => p.codigoFornecedor))]);

/** Fornecedor de menor preço por produto; produto sem oferta fica sem escolha. */
function menorPreco(detalhe: DetalheCotacao): Escolhas {
  const escolhas: Escolhas = {};
  for (const p of detalhe.produtos) {
    let melhor: { codigo: number; valor: number } | null = null;
    for (const f of detalhe.fornecedores) {
      const valor = p.precos[f.codigo];
      if (valor !== null && valor !== undefined && (!melhor || valor < melhor.valor)) melhor = { codigo: f.codigo, valor };
    }
    if (!melhor) continue;
    const lojas = p.lojas ?? [];
    if (!lojas.some((l) => l.definidas?.length)) {
      escolhas[p.produtoId] = melhor.codigo;
      continue;
    }
    // Há quantidade definida no Lançamento: a divisão começa nela; o resto (e o de quem não deu preço) vai no menor preço.
    const barato = melhor.codigo;
    escolhas[p.produtoId] = lojas.flatMap((l) => {
      const partes = new Map((l.definidas ?? []).filter((d) => (p.precos[d.codigoFornecedor] ?? null) !== null).map((d) => [d.codigoFornecedor, d.quantidade]));
      const resto = l.quantidade - [...partes.values()].reduce((t, n) => t + n, 0);
      if (resto > 0) partes.set(barato, (partes.get(barato) ?? 0) + resto);
      return [...partes].map(([codigoFornecedor, quantidade]) => ({ codigoLoja: l.codigoLoja, codigoFornecedor, quantidade }));
    });
  }
  return escolhas;
}

/** Botão "Enviar planilha": o seletor de arquivo do navegador fica escondido, porque o texto dele sai no idioma do sistema. */
function EnvioPlanilha({ rotulo, onArquivos }: { rotulo: string; onArquivos: (arquivos: File[]) => void }) {
  const campo = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => campo.current?.click()}>
        <Upload /> Importar planilhas
      </Button>
      <Input
        ref={campo}
        hidden
        type="file"
        accept=".xlsx"
        multiple
        aria-label={rotulo}
        onChange={(e) => {
          const arquivos = [...(e.target.files ?? [])];
          e.target.value = "";
          if (arquivos.length > 0) onArquivos(arquivos);
        }}
      />
    </>
  );
}

/** Cotação do Pedido: a planilha de cada fornecedor (baixar, importar com prévia) e a comparação de preços. */
export function CotacaoWindow({ pedidoId, lojas = [] }: { pedidoId: string; lojas?: LojaOpcao[] }) {
  const { windows, feedback } = useUi();
  const base = `${PEDIDOS_BASE}/${pedidoId}/cotacao`;
  const [detalhe, setDetalhe] = useState<DetalheCotacao | null>(null);
  /** Marcações do usuário sobre a escolha padrão (menor preço). */
  const [trocas, setTrocas] = useState<Record<string, Marcados>>({});
  const [linhas, setLinhas] = useState<LinhaConferida[] | null>(null);
  const erro = useCallback((err: unknown, padrao: string) => feedback.notifyError(err instanceof Error ? err : new Error(padrao)), [feedback]);

  useEffect(() => {
    apiFetch<DetalheCotacao>(base)
      .then(setDetalhe)
      .catch((err: unknown) => erro(err, "Erro ao carregar a cotação."));
  }, [base, erro]);

  const baixarPlanilha = async (f: { codigo: number }, modo: ModoDownload = "consolidado") => {
    try {
      const { nome, conteudo } = await apiFetch<{ nome: string; conteudo: string }>(`${base}/${f.codigo}/planilha${modo === "loja" ? "?modo=loja" : ""}`);
      baixar(nome, conteudo);
    } catch (err: unknown) {
      erro(err, "Erro ao gerar a planilha.");
    }
  };

  /** Um envio serve a qualquer distribuidora: o arquivo diz de quem é, e a versão é lida na hora para vários arquivos em sequência. */
  const importar = async (arquivo: File) => {
    try {
      const conteudo = await emBase64(arquivo);
      const { codigoFornecedor } = await apiFetch<{ codigoFornecedor: number }>(`${base}/identificar`, json("POST", { arquivo: conteudo }));
      const atual = await apiFetch<DetalheCotacao>(base);
      const f = atual.fornecedores.find((x) => x.codigo === codigoFornecedor);
      if (!f) throw new Error("Esta planilha é de um fornecedor que não participa desta cotação.");
      const previa = await apiFetch<Previa>(`${base}/${f.codigo}/previa`, json("POST", { arquivo: conteudo }));
      if (previa.erros.length > 0) {
        await windows.open({ surface: "dialog", size: "medium", title: `Planilha de ${f.nome}`, content: () => <ErrosDaPrevia erros={previa.erros} /> });
        return;
      }
      const resumo = [plural(previa.validas, "preço válido", "preços válidos"), plural(previa.semOferta, "linha sem oferta", "linhas sem oferta")];
      if (previa.quantidadesDiferentes > 0) resumo.push(plural(previa.quantidadesDiferentes, "quantidade diferente da pedida", "quantidades diferentes da pedida"));
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

  /** O modal de download: as planilhas da cotação (todas as distribuidoras) ou os PDFs (só as escolhidas no Pedido confirmado). */
  const abrirDownloads = async (tipo: "planilha" | "PDF", sobre: DetalheCotacao | null = detalhe) => {
    if (!sobre) return;
    const codigos = tipo === "PDF" ? new Set(Object.values(sobre.pedido.escolhas).flatMap(fornecedoresDe)) : null;
    const distribuidoras = sobre.fornecedores.filter((f) => !codigos || codigos.has(f.codigo)).map((f) => ({ codigo: f.codigo, nome: f.nome, situacao: tipo === "planilha" ? (f.importado ? "Preços importados" : "Aguardando preços") : undefined }));
    await windows.open({
      surface: "dialog",
      size: "large",
      title: tipo === "PDF" ? "PDFs do Pedido por fornecedor" : "Planilhas por fornecedor",
      description: tipo === "PDF" ? "Pedido de compra de cada fornecedor, com os produtos e as quantidades confirmados." : "Uma planilha para cada fornecedor, só com os produtos pedidos a ela.",
      content: () => <CotacaoDownloadsWindow distribuidoras={distribuidoras} tipo={tipo} baixar={(d, modo) => (tipo === "PDF" ? baixarPdf(d, modo) : baixarPlanilha(d, modo))} />,
    });
  };

  const importarTodas = async (arquivos: File[]) => {
    for (const arquivo of arquivos) await importar(arquivo);
  };

  const baixarPdf = async (f: { codigo: number }, modo: ModoDownload = "consolidado") => {
    try {
      const { nome, conteudo } = await apiFetch<{ nome: string; conteudo: string }>(`${PEDIDOS_BASE}/${pedidoId}/pdf/${f.codigo}${modo === "loja" ? "?modo=loja" : ""}`);
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
  /** Confirmado mostra o que foi gravado; antes disso, o menor preço de cada produto com as marcações do usuário por cima. */
  const padrao = confirmado ? detalhe.pedido.escolhas : menorPreco(detalhe);
  const marcados = Object.fromEntries(detalhe.produtos.map((p) => [p.produtoId, (confirmado ? undefined : trocas[p.produtoId]) ?? marcadosDa(p, padrao[p.produtoId])]));
  const confirmarPedido = async () => {
    const ok = await windows.confirm({ title: "Confirmar Pedido", description: "Confirmar o Pedido com os fornecedores escolhidos? Depois de confirmado a escolha não muda.", confirmLabel: "Confirmar Pedido" });
    if (!ok) return;
    try {
      const escolhas: Escolhas = Object.fromEntries(Object.entries(marcados).flatMap(([id, m]) => (parcelasDe(m).length ? [[id, parcelasDe(m)]] : [])));
      await apiFetch(`${PEDIDOS_BASE}/${pedidoId}/confirmar`, json("POST", { escolhas, version: detalhe.pedido.version }));
      feedback.notify({ type: "success", title: "Pedido confirmado." });
    } catch (err: unknown) {
      erro(err, "Erro ao confirmar o Pedido.");
    }
    const novo = await apiFetch<DetalheCotacao>(base).catch(() => detalhe);
    setDetalhe(novo);
    // Confirmado: já abre o download do PDF de cada distribuidora.
    if (CONFIRMADOS.includes(novo.pedido.status)) await abrirDownloads("PDF", novo);
  };
  const nomeLoja = (codigo: number) => lojas.find((l) => l.codigo === codigo)?.nome ?? `Loja ${codigo}`;
  const lojasFornecedoras = (detalhe.lojasFornecedoras ?? []).map((codigo) => ({ codigo, nome: nomeLoja(codigo) }));
  const botaoDasLojas = lojasFornecedoras.length > 0 && detalhe.podeConfirmar ? (
    <Button type="button" variant="outline" onClick={() => void abrirPdfsDasLojas({ windows, feedback }, pedidoId, lojasFornecedoras, baixar)}>
      <FileText /> PDFs das Lojas
    </Button>
  ) : null;

  return (
    <>
      <Stack gap="field" viewport="modal">
        {!confirmado && (
          <Stack direction="row" gap="group" align="center" justify="between" wrap>
            <Text tone="muted">Baixe a planilha de cada fornecedor e, com os preços preenchidos, importe todas de uma vez: o arquivo já diz de quem é.</Text>
            <Stack direction="row" gap="field" align="center">
              <Button type="button" variant="outline" onClick={() => void abrirDownloads("planilha")}>
                <Download /> Baixar planilhas
              </Button>
              {botaoDasLojas}
              <EnvioPlanilha rotulo="Planilhas preenchidas" onArquivos={(arquivos) => void importarTodas(arquivos)} />
            </Stack>
          </Stack>
        )}
        {confirmado ? (
          <Stack direction="row" gap="group" wrap>
            <Button type="button" variant="outline" onClick={() => void abrirDownloads("PDF")}>
              <FileText /> Baixar PDFs
            </Button>
            {botaoDasLojas}
            <Button type="button" onClick={() => void conferirNf()}>Conferir NF</Button>
          </Stack>
        ) : null}
        {linhas ? (
          <DataTable
            title="Conferência com a NF"
            columns={[
              { key: "codigo", label: "Código", value: (l: LinhaConferida) => detalhe.produtos.find((p) => p.produtoId === l.produtoId)?.codigoProduto ?? "", searchable: true, sortable: true, cellClassName: "font-mono text-xs" },
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
        <CotacaoComparacao
          produtos={detalhe.produtos}
          fornecedores={detalhe.fornecedores}
          marcados={marcados}
          editavel={editavel}
          confirmado={confirmado}
          nomeLoja={nomeLoja}
          onChange={(produtoId, m) => setTrocas((t) => ({ ...t, [produtoId]: m }))}
        />
      </Stack>
      <WindowActions>
        <WindowCancelButton>Fechar</WindowCancelButton>
        {editavel ? <Button type="button" onClick={() => void confirmarPedido()}>Confirmar Pedido</Button> : null}
      </WindowActions>
    </>
  );
}
