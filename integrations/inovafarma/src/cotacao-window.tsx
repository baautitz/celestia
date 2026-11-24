import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Upload } from "lucide-react";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { Input } from "@platform/ui/components/input";
import { Stack, Text } from "@platform/ui/components/layout";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { CotacaoDownloadsWindow } from "./cotacao-downloads-window";
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
  codigoProduto?: number | null;
  nome: string;
  quantidade: number;
  /** Código do fornecedor -> preço; null = sem oferta. */
  precos: Record<string, number | null>;
  /** Código do fornecedor -> quantidade que o Pedido pede a ele, e a que ele confirmou na planilha (null = não mexeu). */
  pedidas: Record<string, number>;
  ofertadas: Record<string, number | null>;
  /** Código do fornecedor -> última compra dele (preço e dia, AAAA-MM-DD); null = nunca comprou. */
  ultimas: Record<string, { preco: number; dia: string } | null>;
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

const preco = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dia = (iso: string) => iso.split("-").reverse().join("/");
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

/** Botão "Enviar planilha": o seletor de arquivo do navegador fica escondido, porque o texto dele sai no idioma do sistema. */
/** Quantidade que a distribuidora atende: número a partir de zero, gravado ao sair do campo. */
function CampoQtde({ valor, rotulo, onChange }: { valor: number; rotulo: string; onChange: (valor: number) => void }) {
  return (
    <Input
      key={valor}
      type="text"
      inputMode="decimal"
      aria-label={rotulo}
      defaultValue={valor}
      onBlur={(e) => {
        const n = Number(e.target.value.trim().replace(",", "."));
        if (e.target.value.trim() === "" || !Number.isFinite(n) || n < 0) {
          e.target.value = String(valor);
          return;
        }
        if (n !== valor) onChange(n);
      }}
    />
  );
}

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
  /** Trocas do usuário sobre a escolha padrão (menor preço). */
  const [trocas, setTrocas] = useState<Record<string, number>>({});
  const [linhas, setLinhas] = useState<LinhaConferida[] | null>(null);
  /** Quantidade editada por (produto, distribuidora), sobre a que ela deixou na planilha. */
  const [qtdes, setQtdes] = useState<Record<string, number>>({});

  const erro = useCallback((err: unknown, padrao: string) => feedback.notifyError(err instanceof Error ? err : new Error(padrao)), [feedback]);

  useEffect(() => {
    apiFetch<DetalheCotacao>(base)
      .then(setDetalhe)
      .catch((err: unknown) => erro(err, "Erro ao carregar a cotação."));
  }, [base, erro]);

  const baixarPlanilha = async (f: { codigo: number }) => {
    try {
      const { nome, conteudo } = await apiFetch<{ nome: string; conteudo: string }>(`${base}/${f.codigo}/planilha`);
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
    const codigos = tipo === "PDF" ? new Set(Object.values(sobre.pedido.escolhas)) : null;
    const distribuidoras = sobre.fornecedores.filter((f) => !codigos || codigos.has(f.codigo)).map((f) => ({ codigo: f.codigo, nome: f.nome, situacao: tipo === "planilha" ? (f.importado ? "Preços importados" : "Aguardando preços") : undefined }));
    await windows.open({
      surface: "dialog",
      size: "large",
      title: tipo === "PDF" ? "PDFs do Pedido por distribuidora" : "Planilhas por distribuidora",
      description: tipo === "PDF" ? "Pedido de compra de cada distribuidora, com os produtos e as quantidades confirmados." : "Uma planilha para cada distribuidora, só com os produtos pedidos a ela.",
      content: () => <CotacaoDownloadsWindow distribuidoras={distribuidoras} tipo={tipo} baixar={(d) => (tipo === "PDF" ? baixarPdf(d) : baixarPlanilha(d))} />,
    });
  };

  const importarTodas = async (arquivos: File[]) => {
    for (const arquivo of arquivos) await importar(arquivo);
  };

  const baixarPdf = async (f: { codigo: number }) => {
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

  /** Por produto, a quantidade da distribuidora escolhida (a editada, a da planilha ou a pedida a ela). */
  const quantidadesEscolhidas = Object.fromEntries(
    detalhe.produtos.flatMap((p) => {
      const codigo = escolhas[p.produtoId];
      return codigo === undefined ? [] : [[p.produtoId, qtdes[`${p.produtoId}|${codigo}`] ?? p.ofertadas?.[codigo] ?? p.pedidas?.[codigo] ?? p.quantidade] as const];
    }),
  );
  const confirmarPedido = async () => {
    const ok = await windows.confirm({ title: "Confirmar Pedido", description: "Confirmar o Pedido com os fornecedores escolhidos? Depois de confirmado a escolha não muda.", confirmLabel: "Confirmar Pedido" });
    if (!ok) return;
    try {
      await apiFetch(`${PEDIDOS_BASE}/${pedidoId}/confirmar`, json("POST", { escolhas, quantidades: quantidadesEscolhidas, version: detalhe.pedido.version }));
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

  const colunas: DataTableColumn<ProdutoCotacao>[] = [
    { key: "codigo", label: "Código", value: (p) => p.codigoProduto ?? "", searchable: true, sortable: true, cellClassName: "font-mono text-xs" },
    { key: "nome", label: "Produto", value: (p) => p.nome, searchable: true, mobileRole: "primary" },
    { key: "quantidade", label: "Qtde pedida", format: "decimal", value: (p) => p.quantidade },
    // Cada distribuidora é um grupo de duas colunas, numa linha só por produto: Preço (escolhe; o tooltip traz a última compra) e Qtde (editável).
    ...detalhe.fornecedores.flatMap((f): DataTableColumn<ProdutoCotacao>[] => {
      const chaveDe = (p: ProdutoCotacao) => `${p.produtoId}|${f.codigo}`;
      const pedidaDe = (p: ProdutoCotacao) => p.pedidas?.[f.codigo] ?? p.quantidade;
      // A quantidade que vale é a editada aqui; senão a que a distribuidora deixou na planilha; senão a pedida.
      const efetivaDe = (p: ProdutoCotacao) => qtdes[chaveDe(p)] ?? p.ofertadas?.[f.codigo] ?? pedidaDe(p);
      const menorDe = (p: ProdutoCotacao) => Math.min(...Object.values(p.precos).filter((x): x is number => x !== null));
      return [
        {
          key: `f${f.codigo}p`,
          group: f.nome,
          label: "Preço",
          width: 96,
          // O tooltip do Desempenho de Vendas, pelo DataTable: preço cotado x última compra desta distribuidora, com a data.
          format: "currency",
          value: (p) => p.precos[f.codigo] ?? null,
          compare: (p) => {
            const ultima = p.ultimas?.[f.codigo];
            return ultima ? { previous: ultima.preco, label: `Última compra em ${dia(ultima.dia)}`, favorable: "down" } : undefined;
          },
          render: (p) => {
            const v = p.precos[f.codigo];
            if (v === null || v === undefined) return <Text tone="muted">-</Text>;
            const menor = v === menorDe(p);
            const valor = menor ? <Text weight="bold" tone="success" title="Menor preço">{preco(v)}</Text> : <Text>{preco(v)}</Text>;
            const escolhido = escolhas[p.produtoId] === f.codigo;
            if (!editavel) return confirmado && escolhido ? <Badge>{preco(v)}</Badge> : valor;
            return (
              <Button type="button" variant={escolhido ? "default" : "outline"} aria-pressed={escolhido} aria-label={`Escolher ${f.nome} para ${p.nome}`} onClick={() => setTrocas((t) => ({ ...t, [p.produtoId]: f.codigo }))}>
                {/* No botão escolhido (fundo escuro) o texto herda a cor do botão: o verde do menor preço não tem contraste. */}
                {escolhido ? <Text title={menor ? "Menor preço" : undefined}>{preco(v)}</Text> : valor}
              </Button>
            );
          },
        },
        {
          key: `f${f.codigo}q`,
          group: f.nome,
          label: "Qtde",
          width: 96,
          // Numérica como o Preço: cabeçalho e valores alinhados à direita nas duas colunas.
          format: "decimal",
          value: (p) => (p.precos[f.codigo] === null || p.precos[f.codigo] === undefined ? null : efetivaDe(p)),
          cellClassName: "[&_input]:w-16 [&_input]:px-1.5 [&_input]:text-right",
          render: (p) => {
            const v = p.precos[f.codigo];
            if (v === null || v === undefined) return null;
            const efetiva = efetivaDe(p);
            const difere = efetiva !== pedidaDe(p);
            if (!editavel) return <Text tone={difere ? "warning" : "default"} weight={difere ? "semibold" : undefined} title={difere ? `Diferente do pedido (${preco(pedidaDe(p))})` : undefined}>{preco(efetiva)}</Text>;
            return (
              <>
                {difere && <Text tone="warning" weight="semibold" title={`Diferente do pedido (${preco(pedidaDe(p))})`}>≠ </Text>}
                <CampoQtde valor={efetiva} rotulo={`Quantidade de ${f.nome} para ${p.nome}`} onChange={(n) => setQtdes((q) => ({ ...q, [chaveDe(p)]: n }))} />
              </>
            );
          },
        },
      ];
    }),
  ];

  return (
    <>
      <Stack gap="section" viewport="modal">
        {!confirmado && (
          <Stack direction="row" gap="group" align="center" justify="between" wrap>
            <Text tone="muted">Baixe a planilha de cada distribuidora e, com os preços preenchidos, importe todas de uma vez: o arquivo já diz de quem é.</Text>
            <Stack direction="row" gap="field" align="center">
              <Button type="button" variant="outline" onClick={() => void abrirDownloads("planilha")}>
                <Download /> Baixar planilhas
              </Button>
              <EnvioPlanilha rotulo="Planilhas preenchidas" onArquivos={(arquivos) => void importarTodas(arquivos)} />
            </Stack>
          </Stack>
        )}
        {confirmado ? (
          <Stack direction="row" gap="group" wrap>
            <Button type="button" variant="outline" onClick={() => void abrirDownloads("PDF")}>
              <FileText /> Baixar PDFs
            </Button>
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
        <Stack grow>
        <DataTable embedded scroll="fill" title="Comparação de preços" columns={colunas} rows={detalhe.produtos} getRowId={(p) => p.produtoId} emptyMessage="Nenhum produto no Pedido." search={{ placeholder: "Buscar produto" }} />
        </Stack>
      </Stack>
      <WindowActions>
        <WindowCancelButton>Fechar</WindowCancelButton>
        {editavel ? <Button type="button" onClick={() => void confirmarPedido()}>Confirmar Pedido</Button> : null}
      </WindowActions>
    </>
  );
}
