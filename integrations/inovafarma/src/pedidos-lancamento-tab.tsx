import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartColumn, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@platform/ui/components/button";
import { Checkbox } from "@platform/ui/components/checkbox";
import { Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList, ComboboxValue, useComboboxAnchor } from "@platform/ui/components/combobox";
import { Input } from "@platform/ui/components/input";
import { DatePicker } from "@platform/ui/components/date-picker";
import { DateRangePicker } from "@platform/ui/components/date-range-picker";
import { Label } from "@platform/ui/components/label";
import { Grid, Stack, Text } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { ApiError, apiFetch } from "@platform/ui/lib/api";
import { formatNumber } from "@platform/ui/lib/format";
import { FalhaAoCarregar, useContexto } from "./contexto";
import { API, json } from "./inovafarma-api";
import { ListaProdutosCampo } from "./lista-produtos-campo";
import type { EntradaLista } from "./tipos-meta";
import { LojasAdicionarWindow } from "./lojas-adicionar-window";
import { EstudoProdutoWindow } from "./pedido-estudo-window";
import { DistribuidorasLinhaWindow, type Distribuidora } from "./distribuidoras-linha-window";
import { PEDIDOS_BASE, type ItemPedido, type Pedido } from "./pedido-rascunho-window";
import type { LojaOpcao } from "./loja-opcao";
import { useLatestFetch } from "./use-latest-fetch";
import type { VisaoPedidos } from "./pedidos-visoes";
import { BASE_VISOES, PedidosVisoesBarra } from "./pedidos-visoes-barra";

const BASE = `${API}/pedidos/lancamento`;
/** Pausa do cursor antes de consultar a movimentação do produto em foco. */
const ESPERA_DETALHE_MS = 180;
const idProduto = (p: ProdutoLancamento) => p.produtoId;
const idLoja = (l: LinhaLoja) => String(l.codigoLoja);
const BUSCA_PRODUTO = { placeholder: "Buscar produto" };

interface Contexto {
  hoje: string;
  ontem: string;
  lojas: LojaOpcao[];
  podeEditarMinimos: boolean;
}

interface LinhaLoja {
  codigoLoja: number;
  vendida: number;
  estoque: number;
  minimo: number | null;
  maximo: number | null;
  sugestao: number;
  /** Pedido aberto menos as entradas de NF. */
  aChegar: number;
  /** 0 enquanto a Loja não tem mínimo/máximo gravado. */
  version: number;
}

export interface ProdutoLancamento {
  produtoId: string;
  /** Código do produto no ERP (o `produtoId` é o identificador opaco). */
  codigoProduto?: number | null;
  nome: string;
  codigoBarra: string | null;
  fabricante?: string;
  formula?: string;
  grupo?: string;
  secao?: string;
  vendida: number;
  estoque: number;
  minimo: number;
  sugestao: number;
  aChegar: number;
  lojas: LinhaLoja[];
}

interface Mes {
  mes: string;
  vendida: number;
  comprada: number;
}

type Modo = "periodo" | "apartir";

const paraDia = (iso: string) => {
  const [a = 0, m = 1, d = 1] = iso.split("-").map(Number);
  return new Date(a, m - 1, d);
};
const paraIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** `AAAA-MM` como `MM/AAAA`. */
const mesBr = (mes: string) => mes.split("-").reverse().join("/");

/** A movimentação mensal em duas linhas (Venda e Compra), com um mês por coluna. */
interface LinhaMovimento {
  tipo: "vendida" | "comprada";
  rotulo: string;
}
const LINHAS_MOVIMENTO: LinhaMovimento[] = [
  { tipo: "vendida", rotulo: "Venda" },
  { tipo: "comprada", rotulo: "Compra" },
];
const idMovimento = (l: LinhaMovimento) => l.tipo;
/** Os 12 meses até o de `hoje` (`AAAA-MM-DD`), do mais antigo ao atual; o mês sem movimento vale zero. */
const ultimosMeses = (hoje: string, meses: Mes[]): Mes[] => {
  const [ano = 0, mes = 1] = hoje.split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(ano, mes - 12 + i, 1));
    const chave = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return meses.find((m) => m.mes === chave) ?? { mes: chave, vendida: 0, comprada: 0 };
  });
};
const colunasMovimento = (meses: Mes[]): DataTableColumn<LinhaMovimento>[] => [
  { key: "tipo", label: "", value: (l) => l.rotulo },
  ...meses.map((m): DataTableColumn<LinhaMovimento> => ({ key: m.mes, label: mesBr(m.mes), format: "decimal", value: (l) => m[l.tipo] })),
];

type FiltrosAplicados = { modo: Modo; de: string; ate: string; lojas: number[]; entradas: EntradaLista[]; apenasMinimo: boolean };

const brData = (iso: string) => iso.split("-").reverse().join("/");
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
/** Uma linha com o que os filtros aplicados escolheram. */
const resumo = (f: FiltrosAplicados) =>
  [
    f.modo === "periodo" ? `Período: ${brData(f.de)} a ${brData(f.ate)}` : `A partir de ${brData(f.de)}`,
    f.lojas.length ? plural(f.lojas.length, "Loja", "Lojas") : "Todas as Lojas",
    f.entradas.length ? "Filtro de produtos" : null,
    f.apenasMinimo ? "Apenas com estoque mínimo" : null,
  ]
    .filter(Boolean)
    .join(" · ");

function FiltroLojas({ lojas, escolhidas, onChange }: { lojas: LojaOpcao[]; escolhidas: number[]; onChange: (codigos: number[]) => void }) {
  const ancora = useComboboxAnchor();
  return (
    <Stack gap="field">
      <Label htmlFor="pedidos-lojas">Lojas</Label>
      <Combobox
        multiple
        autoHighlight
        items={lojas}
        value={lojas.filter((l) => escolhidas.includes(l.codigo))}
        onValueChange={(v: LojaOpcao[]) => onChange(v.map((l) => l.codigo))}
        itemToStringLabel={(l: LojaOpcao) => l.nome || `Loja ${l.codigo}`}
        itemToStringValue={(l: LojaOpcao) => String(l.codigo)}
        isItemEqualToValue={(a: LojaOpcao, b: LojaOpcao) => a.codigo === b.codigo}
      >
        <ComboboxChips ref={ancora}>
          <ComboboxValue>
            {(v: LojaOpcao[]) => (
              <>
                {v.map((l) => (
                  <ComboboxChip key={l.codigo}>{l.nome || `Loja ${l.codigo}`}</ComboboxChip>
                ))}
                <ComboboxChipsInput id="pedidos-lojas" placeholder={v.length === 0 ? "Todas as Lojas" : ""} />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent anchor={ancora}>
          <ComboboxEmpty>Nenhuma Loja encontrada.</ComboboxEmpty>
          <ComboboxList>
            {(l: LojaOpcao) => (
              <ComboboxItem key={l.codigo} value={l}>
                {l.nome || `Loja ${l.codigo}`}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Stack>
  );
}

/** O que o servidor devolve ao gravar o mínimo/máximo de uma Loja. */
interface MinimoGravado {
  codigoLoja: number;
  minimo: number;
  maximo: number | null;
  version: number;
}

/** Aplica o mínimo/máximo gravado na linha da Loja e refaz a sugestão e os totais do produto, sem consultar o ERP. */
function comMinimoGravado(produto: ProdutoLancamento, gravado: MinimoGravado): ProdutoLancamento {
  // A Loja sem venda no período não vem na lista do produto (a grade a mostra com linha vazia): ao gravar, ela entra com a version nova,
  // senão a próxima edição mandaria a version 0 e o servidor recusaria como conflito.
  const base = produto.lojas.some((l) => l.codigoLoja === gravado.codigoLoja)
    ? produto.lojas
    : [...produto.lojas, { codigoLoja: gravado.codigoLoja, vendida: 0, estoque: 0, minimo: null, maximo: null, sugestao: 0, aChegar: 0, version: 0 }];
  const lojas = base.map((l) => (l.codigoLoja === gravado.codigoLoja ? { ...l, minimo: gravado.minimo, maximo: gravado.maximo, version: gravado.version, sugestao: Math.max(0, l.vendida + gravado.minimo - l.estoque) } : l));
  return { ...produto, lojas, minimo: lojas.reduce((soma, l) => soma + (l.minimo ?? 0), 0), sugestao: lojas.reduce((soma, l) => soma + l.sugestao, 0) };
}

/** Célula editável do mínimo ou do máximo da Loja: grava ao sair do campo, se mudou. */
function CampoMinimoMaximo({ linha, produtoId, campo, rotulo, onSalvo }: { linha: LinhaLoja; produtoId: string; campo: "minimo" | "maximo"; rotulo: string; onSalvo: (produtoId: string, gravado?: MinimoGravado) => void }) {
  const { feedback } = useUi();
  const atual = linha[campo];
  // Valor recusado: o campo volta ao gravado sem recarregar a grade (e sem perder o foco da tabela).
  const [volta, setVolta] = useState(0);
  const recusar = (mensagem: string) => {
    feedback.notifyError(new Error(mensagem));
    setVolta((n) => n + 1);
  };
  const gravar = async (texto: string) => {
    const valor = texto.trim() === "" ? null : Number(texto.replace(",", "."));
    if (valor === atual || (valor === null && campo === "minimo")) return;
    if (valor !== null && (!Number.isFinite(valor) || valor < 0)) return recusar("Informe um valor maior ou igual a zero.");
    const minimo = campo === "minimo" ? valor : (linha.minimo ?? 0);
    const maximo = campo === "maximo" ? valor : linha.maximo;
    if (maximo !== null && minimo !== null && maximo < minimo) return recusar("O máximo não pode ser menor que o mínimo.");
    const corpo = { produtoId, codigoLoja: linha.codigoLoja, minimo, maximo, version: linha.version };
    try {
      const gravado = await apiFetch<MinimoGravado>(`${BASE}/minimos`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      // Só a linha editada muda: a grade não recarrega.
      onSalvo(produtoId, gravado);
    } catch (err: unknown) {
      // O servidor prefixa o campo ("maximo: ..."); a tela mostra só a mensagem.
      recusar(err instanceof Error ? err.message.replace(/^[a-zA-Z]+: /, "") : "Erro ao gravar o estoque mínimo.");
      // Só o conflito de `version` (409) pede os valores atuais, e a releitura é silenciosa.
      if (err instanceof ApiError && err.status === 409) onSalvo(produtoId);
    }
  };
  return (
    <Input
      key={`${linha.version}-${atual}-${volta}`}
      type="text"
      inputMode="decimal"
      aria-label={rotulo}
      defaultValue={atual ?? ""}
      onBlur={(e) => void gravar(e.target.value)}
    />
  );
}

/** Quanto falta para o estoque mínimo da Loja: o que o campo Pedir traz antes de digitar. */
const faltaParaMinimo = (l: LinhaLoja) => Math.max(0, Math.ceil((l.minimo ?? 0) - l.estoque));
/** Chave da quantidade a pedir de um produto numa Loja. */
const chaveQtd = (produtoId: string, codigoLoja: number) => `${produtoId}:${codigoLoja}`;

/** Célula editável da quantidade a pedir da Loja: confirma ao sair do campo. */
function CampoPedir({ valor, rotulo, onChange }: { valor: number | undefined; rotulo: string; onChange: (valor: number) => void }) {
  return (
    <Input
      key={valor ?? ""}
      type="text"
      inputMode="decimal"
      aria-label={rotulo}
      defaultValue={valor ?? ""}
      onBlur={(e) => {
        const n = e.target.value.trim() === "" ? 0 : Number(e.target.value.replace(",", "."));
        if (!Number.isFinite(n) || n < 0) {
          e.target.value = String(valor ?? "");
          return;
        }
        if (n !== (valor ?? 0)) onChange(n);
      }}
    />
  );
}

/** Célula das distribuidoras da Loja: o resumo e o botão que abre a janela de busca e lista. */
function CampoDistribuidoras({ produtoId, codigoLoja, nomeLoja, valor, lista, onChange }: { produtoId: string; codigoLoja: number; nomeLoja: string; valor: number[] | undefined; lista: Distribuidora[]; onChange: (codigos: number[]) => void }) {
  const { windows } = useUi();
  const curto = (nome: string) => (nome.length > 18 ? `${nome.slice(0, 17)}…` : nome);
  const resumo = !valor || valor.length === 0 ? "Escolher" : valor.length === 1 ? curto(lista.find((d) => d.codigo === valor[0])?.nome ?? `Distribuidora ${valor[0]}`) : `${valor.length} distribuidoras`;
  const abrir = async () => {
    const resultado = await windows.open<number[]>({
      surface: "dialog",
      size: "large",
      title: "Distribuidoras",
      description: `Loja ${nomeLoja}. Começa com as que já deram entrada neste produto.`,
      content: () => <DistribuidorasLinhaWindow produtoId={produtoId} codigoLoja={codigoLoja} inicial={valor} lista={lista} />,
    });
    if (resultado.status === "confirmed") onChange(resultado.value);
  };
  return (
    <Button type="button" variant="outline" aria-label={`Distribuidoras da Loja ${nomeLoja}`} onClick={() => void abrir()}>
      {resumo}
    </Button>
  );
}

/** Campo de mínimo/máximo estreito e à direita, para a tabela de Lojas caber sem rolagem lateral. */
const CAMPO_LOJA = "[&_input]:w-14 [&_input]:px-1.5 [&_input]:text-right";

const Detalhe = memo(function Detalhe({ produto, contexto, lojasFiltro, onSalvo, quantidades, onQuantidade, distribuidoras, listaDistribuidoras, onDistribuidora, removidas, onRemovidas }: { removidas: number[]; onRemovidas: (codigos: number[]) => void; produto: ProdutoLancamento | undefined; contexto: Contexto; lojasFiltro: number[]; onSalvo: (produtoId: string, gravado?: MinimoGravado) => void; quantidades: Map<string, number>; onQuantidade: (produto: ProdutoLancamento, codigoLoja: number, quantidade: number) => void; distribuidoras: Map<string, number[]>; listaDistribuidoras: Distribuidora[]; onDistribuidora: (produto: ProdutoLancamento, codigoLoja: number, codigos: number[]) => void }) {
  const { feedback } = useUi();
  const novaConsulta = useLatestFetch();
  const [meses, setMeses] = useState<Mes[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [lojaAtiva, setLojaAtiva] = useState<string | null>(null);
  const [apenasLoja, setApenasLoja] = useState(true);
  const [ultimasCompras, setUltimasCompras] = useState<Map<number, number>>(() => new Map());

  const codigoLoja = apenasLoja && produto && contexto.lojas.some((l) => String(l.codigo) === lojaAtiva) ? lojaAtiva : null;
  const consultaLojas = codigoLoja ? codigoLoja : lojasFiltro.join(",");
  const idFoco = produto?.produtoId;
  useEffect(() => {
    if (!idFoco) {
      setMeses([]);
      setCarregando(false);
      return;
    }
    const vale = novaConsulta();
    setCarregando(true);
    const params = new URLSearchParams({ produtoId: idFoco });
    if (consultaLojas) params.set("lojas", consultaLojas);
    // Segurando a seta, o cursor passa por vários produtos: só consulta quando ele para.
    const espera = setTimeout(() => {
      apiFetch<Mes[]>(`${BASE}/movimentacao?${params}`)
        .then((r) => vale() && setMeses(r))
        .catch((err: unknown) => {
          if (!vale()) return;
          setMeses([]);
          feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar a movimentação mensal."));
        })
        .finally(() => vale() && setCarregando(false));
    }, ESPERA_DETALHE_MS);
    return () => clearTimeout(espera);
  }, [idFoco, consultaLojas, feedback, novaConsulta]);

  // O valor unitário da última compra em cada Loja, do produto em foco (mesma pausa do cursor da movimentação).
  useEffect(() => {
    if (!idFoco) {
      setUltimasCompras(new Map());
      return;
    }
    let atual = true;
    const espera = setTimeout(() => {
      apiFetch<{ codigoLoja: number; preco: number }[]>(`${BASE}/ultimas-compras?produtoId=${encodeURIComponent(idFoco)}`)
        .then((r) => atual && setUltimasCompras(new Map(r.map((l) => [l.codigoLoja, l.preco]))))
        .catch(() => atual && setUltimasCompras(new Map()));
    }, ESPERA_DETALHE_MS);
    return () => {
      atual = false;
      clearTimeout(espera);
    };
  }, [idFoco]);

  const produtoId = produto?.produtoId ?? "";
  const colunasLoja = useMemo<{ estatisticas: DataTableColumn<LinhaLoja>[]; pedido: DataTableColumn<LinhaLoja>[] }>(() => {
    const nomeLoja = (codigo: number) => contexto.lojas.find((l) => l.codigo === codigo)?.nome || `Loja ${codigo}`;
    const loja: DataTableColumn<LinhaLoja> = { key: "loja", label: "Loja", value: (l) => nomeLoja(l.codigoLoja) };
    const estatisticas: DataTableColumn<LinhaLoja>[] = [
    loja,
    { key: "estoque", label: "Estoque", tooltip: "Estoque atual", format: "decimal", value: (l) => l.estoque },
    { key: "vendida", label: "Vendida", tooltip: "Qtde vendida", format: "decimal", value: (l) => l.vendida },
    contexto.podeEditarMinimos
      ? { key: "minimo", label: "Mín.", tooltip: "Estoque mínimo", format: "decimal", render: (l) => <CampoMinimoMaximo linha={l} produtoId={produtoId} campo="minimo" rotulo={`Estoque mínimo da Loja ${nomeLoja(l.codigoLoja)}`} onSalvo={onSalvo} />, cellClassName: CAMPO_LOJA, mobileWide: true }
      : { key: "minimo", label: "Mín.", tooltip: "Estoque mínimo", format: "decimal", value: (l) => l.minimo ?? 0 },
    { key: "sugestao", label: "Sug.", tooltip: "Sugestão", format: "decimal", value: (l) => l.sugestao },
    { key: "aChegar", label: "A chegar", format: "decimal", value: (l) => l.aChegar },
    { key: "ultimaCompra", label: "Últ. compra", tooltip: "Valor unitário da última compra", format: "currency", value: (l) => ultimasCompras.get(l.codigoLoja) ?? null },
    ];
    const pedido: DataTableColumn<LinhaLoja>[] = [
    loja,
    { key: "pedir", label: "Pedir", tooltip: "Quantidade a pedir", format: "decimal", render: (l) => <CampoPedir valor={quantidades.get(chaveQtd(produtoId, l.codigoLoja)) ?? faltaParaMinimo(l)} rotulo={`Quantidade a pedir da Loja ${nomeLoja(l.codigoLoja)}`} onChange={(q) => produto && onQuantidade(produto, l.codigoLoja, q)} />, cellClassName: CAMPO_LOJA, mobileWide: true },
    { key: "distribuidora", label: "Distribuidora", render: (l) => <CampoDistribuidoras produtoId={produtoId} codigoLoja={l.codigoLoja} nomeLoja={nomeLoja(l.codigoLoja)} valor={distribuidoras.get(chaveQtd(produtoId, l.codigoLoja))} lista={listaDistribuidoras} onChange={(c) => produto && onDistribuidora(produto, l.codigoLoja, c)} />, mobileWide: true },
    { key: "remover", label: "", width: 40, centered: true, render: (l) => <Button type="button" variant="outline" size="icon" aria-label={`Remover a Loja ${nomeLoja(l.codigoLoja)}`} onClick={() => onRemovidas([...removidas, l.codigoLoja])}><X /></Button>, mobileRole: "hidden" },
    ];
    return { estatisticas, pedido };
  }, [removidas, onRemovidas, contexto.lojas, contexto.podeEditarMinimos, ultimasCompras, produtoId, produto, onSalvo, quantidades, onQuantidade, distribuidoras, listaDistribuidoras, onDistribuidora]);
  // Todas as Lojas, mesmo as sem venda nem estoque do produto (zeradas).
  const todasLojas = useMemo<LinhaLoja[]>(() => {
    if (!produto) return [];
    return contexto.lojas.filter((l) => !removidas.includes(l.codigo)).map((l) => produto.lojas.find((x) => x.codigoLoja === l.codigo) ?? { codigoLoja: l.codigo, vendida: 0, estoque: 0, minimo: null, maximo: null, sugestao: 0, aChegar: 0, version: 0 });
  }, [produto, contexto.lojas, removidas]);
  const removidasOpcoes = contexto.lojas.filter((l) => removidas.includes(l.codigo));
  const { windows } = useUi();
  const adicionarLojas = async () => {
    const resultado = await windows.open<number[]>({ surface: "dialog", size: "medium", title: "Adicionar Lojas", description: "Escolha as Lojas que voltam para o Pedido.", content: () => <LojasAdicionarWindow removidas={removidasOpcoes} /> });
    if (resultado.status === "confirmed") onRemovidas(removidas.filter((c) => !resultado.value.includes(c)));
  };
  const abrirEstudo = () => {
    if (!produto) return;
    void windows.open<void>({ surface: "dialog", size: "screen", title: `Estudo do produto: ${produto.nome}`, content: () => <EstudoProdutoWindow produto={produto} lojas={contexto.lojas} /> });
  };
  const colunasMes = useMemo(() => colunasMovimento(ultimosMeses(contexto.hoje, meses)), [contexto.hoje, meses]);
  const vazio = "Selecione um produto para ver o estoque e as vendas por Loja e a movimentação mensal.";
  return (
    <>
      <Stack grow>
        <DataTable scroll="fill" compact title={produto ? `Lojas: ${produto.nome}` : "Lojas"} headerActions={removidasOpcoes.length > 0 ? <Button type="button" variant="outline" onClick={() => void adicionarLojas()}>Adicionar Loja</Button> : undefined} columns={colunasLoja.pedido} rows={todasLojas} getRowId={idLoja} activeRowId={lojaAtiva} onActiveRowChange={setLojaAtiva} emptyMessage={produto ? "Nenhuma Loja." : vazio} />
      </Stack>
      <Stack span="full" scroll="clip" surface="card" gap="section">
        <Stack direction="row" gap="group" align="center" justify="between" shrink={false}>
          <Text weight="semibold">{produto ? `Movimentação mensal: ${produto.nome}` : "Movimentação mensal"}</Text>
          <Stack direction="row" gap="field" align="center" shrink={false}>
            <Button type="button" variant="outline" disabled={!produto} onClick={abrirEstudo}><ChartColumn />Estudo do produto</Button>
            <Checkbox id="pedidos-apenas-loja" checked={apenasLoja} onCheckedChange={(v: boolean) => setApenasLoja(v)} />
            <Label htmlFor="pedidos-apenas-loja">Apenas a Loja selecionada</Label>
          </Stack>
        </Stack>
        <Stack grow scroll gap="section">
          <DataTable embedded compact skeletonRows={2} columns={colunasMes} rows={produto ? LINHAS_MOVIMENTO : []} getRowId={idMovimento} loading={carregando} emptyMessage={produto ? "Sem vendas nem compras nos últimos 12 meses." : vazio} />
          <DataTable embedded compact columns={colunasLoja.estatisticas} rows={todasLojas} getRowId={idLoja} activeRowId={lojaAtiva} onActiveRowChange={setLojaAtiva} emptyMessage={produto ? "Nenhuma Loja." : vazio} />
        </Stack>
      </Stack>
    </>
  );
});

/** Aba Lançamento: filtros, grade de produtos com seleção e, do produto em foco, as Lojas e a movimentação mensal. */
export function PedidosLancamentoTab({ abas }: { abas: ReactNode }) {
  const { feedback } = useUi();
  const { contexto, falha, carregar } = useContexto<Contexto>(`${BASE}/contexto`, "Erro ao carregar o Lançamento de Pedidos.");
  if (!contexto) {
    return falha ? (
      <FalhaAoCarregar titulo="Não foi possível carregar o Lançamento de Pedidos" descricao={falha} onTentarNovamente={() => void carregar()} />
    ) : null;
  }
  return <Lancamento contexto={contexto} notificar={feedback.notifyError} abas={abas} />;
}

/** O Lançamento num modal para editar um rascunho: a mesma tela, já com os produtos, quantidades e distribuidoras do Pedido. */
export function PedidoLancamentoWindow({ pedido }: { pedido: Pedido }) {
  const { resolve } = useWindow<Pedido>();
  const { feedback } = useUi();
  const { contexto, falha, carregar } = useContexto<Contexto>(`${BASE}/contexto`, "Erro ao carregar o Lançamento de Pedidos.");
  if (!contexto) {
    return falha ? <FalhaAoCarregar titulo="Não foi possível carregar o Lançamento de Pedidos" descricao={falha} onTentarNovamente={() => void carregar()} /> : null;
  }
  return <Lancamento contexto={contexto} notificar={feedback.notifyError} abas={null} edicao={{ pedido, aoSalvar: resolve }} />;
}

interface ResultadoFiltros {
  filtros: FiltrosAplicados;
  visao: string | null;
  visoes: VisaoPedidos[];
}

/** Filtros que uma visão deixa sobre `base`: a data não muda; Lojas que sumiram ficam de fora. */
const comVisao = (base: FiltrosAplicados, v: VisaoPedidos | null, contexto: Contexto): FiltrosAplicados =>
  v
    ? {
        ...base,
        lojas: v.lojas.filter((codigo) => contexto.lojas.some((l) => l.codigo === codigo)),
        entradas: v.entradas,
        apenasMinimo: v.apenasComMinimo,
      }
    : base;

/** Corpo do sheet "Filtros": edita um rascunho e só devolve o resultado em "Filtrar". */
function FiltrosSheet({ contexto, inicial, visoesIniciais, visaoInicial }: { contexto: Contexto; inicial: FiltrosAplicados; visoesIniciais: VisaoPedidos[]; visaoInicial: string | null }) {
  const { resolve } = useWindow<ResultadoFiltros>();
  const { feedback } = useUi();
  const [rascunho, setRascunho] = useState(inicial);
  const [visoes, setVisoes] = useState(visoesIniciais);
  const [visao, setVisao] = useState(visaoInicial);
  const { modo, de, ate, lojas, entradas, apenasMinimo } = rascunho;
  const editar = (parte: Partial<FiltrosAplicados>) => setRascunho((r) => ({ ...r, ...parte }));

  const recarregarVisoes = async (salva?: VisaoPedidos) => {
    try {
      setVisoes(await apiFetch<VisaoPedidos[]>(BASE_VISOES));
      if (salva) setVisao(salva.id);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar as visões."));
    }
  };

  return (
    <Stack gap="section">
      <Grid columns="split" gap="group">
        <Stack gap="field">
          <Label>Data</Label>
          <Select value={modo} onValueChange={(v) => v && editar({ modo: v as Modo })}>
            <SelectTrigger aria-label="Modo da data">
              <SelectValue>{(v: Modo) => (v === "periodo" ? "Período" : "A partir de")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="periodo">Período</SelectItem>
              <SelectItem value="apartir">A partir de</SelectItem>
            </SelectContent>
          </Select>
        </Stack>
        <Stack gap="field">
          <Label>{modo === "periodo" ? "Período" : "A partir de"}</Label>
          {modo === "periodo" ? (
            <DateRangePicker
              value={{ from: paraDia(de), to: paraDia(ate) }}
              onChange={(r) => {
                if (!r?.from || !r.to) return;
                editar({ de: paraIso(r.from), ate: paraIso(r.to) });
              }}
            />
          ) : (
            <DatePicker value={paraDia(de)} onChange={(d) => d && editar({ de: paraIso(d) })} />
          )}
        </Stack>
      </Grid>
      <PedidosVisoesBarra
        visoes={visoes}
        selecionada={visao}
        filtros={{ lojas, entradas, apenasComMinimo: apenasMinimo }}
        onAplicar={(v) => {
          setVisao(v?.id ?? null);
          setRascunho((r) => comVisao(r, v, contexto));
        }}
        onMudou={(salva) => void recarregarVisoes(salva)}
      />
      <FiltroLojas lojas={contexto.lojas} escolhidas={lojas} onChange={(l) => editar({ lojas: l })} />
      <ListaProdutosCampo rotulo="Filtro de produtos" entradas={entradas} onChange={(e) => editar({ entradas: e })} />
      <Stack direction="row" gap="field" align="center">
        <Checkbox id="pedidos-apenas-minimo" checked={apenasMinimo} onCheckedChange={(v: boolean) => editar({ apenasMinimo: v })} />
        <Label htmlFor="pedidos-apenas-minimo">Apenas com estoque mínimo</Label>
      </Stack>
      <WindowActions>
        <WindowCancelButton />
        <Button type="button" onClick={() => resolve({ filtros: rascunho, visao, visoes })}>
          Filtrar
        </Button>
      </WindowActions>
    </Stack>
  );
}

/** Edição de um rascunho: o Pedido aberto e o que fazer depois de salvar (fechar a janela). */
interface EdicaoPedido {
  pedido: Pedido;
  aoSalvar: (salvo: Pedido) => void;
}

/** O que o Lançamento de correção recebe (produtos e Lojas faltantes) e devolve ao salvar. */
interface Correcao {
  produtos: ProdutoLancamento[];
  quantidades: Map<string, number>;
  distribuidoras: Map<string, number[]>;
  /** Lojas já fora da grade: as que não faltam em nenhum produto. */
  ocultas: number[];
  aoSalvar: (resultado: ResultadoCorrecao) => void;
}
interface ResultadoCorrecao {
  quantidades: Map<string, number>;
  distribuidoras: Map<string, number[]>;
  /** Lojas tiradas durante a correção. */
  removidas: number[];
  /** Produtos que continuam marcados. */
  marcados: string[];
}

/** Produto marcado, Loja na grade e Pedir em zero: o que impede de salvar. */
const pendenciasDe = (selecionados: Iterable<ProdutoLancamento>, quantidades: Map<string, number>, removidas: number[]) =>
  [...selecionados].flatMap((p) => p.lojas.filter((l) => !removidas.includes(l.codigoLoja) && (quantidades.get(chaveQtd(p.produtoId, l.codigoLoja)) ?? faltaParaMinimo(l)) <= 0).map((l) => ({ produto: p, codigoLoja: l.codigoLoja })));

/** O mesmo Lançamento, só com os produtos e as Lojas faltantes; Salvar aplica no Pedido em montagem e fecha. */
function CorrecaoWindow({ contexto, correcao }: { contexto: Contexto; correcao: Omit<Correcao, "aoSalvar"> }) {
  const { resolve } = useWindow<ResultadoCorrecao>();
  const { feedback } = useUi();
  return <Lancamento contexto={contexto} notificar={feedback.notifyError} abas={null} correcao={{ ...correcao, aoSalvar: resolve }} />;
}

function Lancamento({ contexto, notificar, abas, edicao, correcao }: { contexto: Contexto; notificar: (e: Error) => void; abas: ReactNode; edicao?: EdicaoPedido; correcao?: Correcao }) {
  const { windows, feedback } = useUi();
  const novaConsulta = useLatestFetch();
  const [visoes, setVisoes] = useState<VisaoPedidos[]>([]);
  const [visao, setVisao] = useState<string | null>(null);
  const [produtos, setProdutos] = useState<ProdutoLancamento[]>(correcao?.produtos ?? []);
  const [carregando, setCarregando] = useState(!correcao);
  // A seleção sobrevive aos filtros: guarda o produto inteiro, para o detalhe não depender da grade atual.
  const [selecionados, setSelecionados] = useState<ReadonlyMap<string, ProdutoLancamento>>(() => new Map((correcao?.produtos ?? []).map((p) => [p.produtoId, p])));
  // O cursor da grade (linha ativa) é o que o detalhe mostra; os marcados só alimentam o "Gerar pedido".
  const [ativo, setAtivo] = useState<string | null>(null);
  // Os filtros só valem na consulta depois de "Filtrar" no sheet; a primeira consulta espera as visões e usa a padrão.
  const [aplicados, setAplicados] = useState<FiltrosAplicados | null>(null);
  const padrao: FiltrosAplicados = { modo: "apartir", de: contexto.ontem, ate: contexto.ontem, lojas: [], entradas: [], apenasMinimo: false };

  // biome-ignore lint/correctness/useExhaustiveDependencies: só na abertura da aba; depois as visões recarregam dentro do sheet.
  useEffect(() => {
    if (correcao) return;
    void (async () => {
      let inicial = padrao;
      try {
        const lista = await apiFetch<VisaoPedidos[]>(BASE_VISOES);
        setVisoes(lista);
        const v = lista.find((x) => x.padrao) ?? null;
        setVisao(v?.id ?? null);
        inicial = comVisao(padrao, v, contexto);
      } catch (err: unknown) {
        notificar(err instanceof Error ? err : new Error("Erro ao carregar as visões."));
      }
      setAplicados(inicial);
    })();
  }, []);

  const abrirFiltros = async () => {
    const atuais = aplicados ?? padrao;
    const r = await windows.open<ResultadoFiltros>({
      surface: "sheet",
      title: "Filtros",
      content: () => <FiltrosSheet contexto={contexto} inicial={atuais} visoesIniciais={visoes} visaoInicial={visao} />,
    });
    if (r.status !== "confirmed") return;
    setVisoes(r.value.visoes);
    setVisao(r.value.visao);
    setAplicados(r.value.filtros);
  };

  /** `silencioso`: releitura sem o efeito de carregando e sem soltar o produto em foco (ex.: após um conflito de version). */
  const carregar = useCallback(async (silencioso = false) => {
    if (!aplicados) return;
    const { modo, de, ate, lojas, entradas, apenasMinimo } = aplicados;
    const vale = novaConsulta();
    const params = new URLSearchParams({ modo, de });
    if (modo === "periodo") params.set("ate", ate);
    if (lojas.length) params.set("lojas", lojas.join(","));
    if (entradas.length) params.set("entradas", JSON.stringify(entradas.map(({ tipo, id }) => ({ tipo, id }))));
    if (apenasMinimo) params.set("apenasMinimo", "1");
    if (!silencioso) {
      setCarregando(true);
      setAtivo(null);
    }
    try {
      const r = await apiFetch<ProdutoLancamento[]>(`${BASE}/produtos?${params}`);
      if (vale()) setProdutos(r);
    } catch (err: unknown) {
      if (vale()) {
        if (!silencioso) setProdutos([]);
        notificar(err instanceof Error ? err : new Error("Erro ao carregar os produtos."));
      }
    } finally {
      if (vale()) setCarregando(false);
    }
  }, [aplicados, notificar, novaConsulta]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const alternar = useCallback((p: ProdutoLancamento, marcado: boolean) => {
    setSelecionados((atual) => {
      const proximo = new Map(atual);
      if (marcado) proximo.set(p.produtoId, p);
      else proximo.delete(p.produtoId);
      return proximo;
    });
  }, []);
  // Lojas tiradas da grade: ficam fora do Pedido todo.
  const [lojasRemovidas, setLojasRemovidas] = useState<number[]>(correcao?.ocultas ?? []);
  // Quantidade a pedir digitada na grade de Lojas; digitar marca o produto.
  const [quantidades, setQuantidades] = useState<Map<string, number>>(() => new Map(correcao?.quantidades));
  const definirQuantidade = useCallback(
    (p: ProdutoLancamento, codigoLoja: number, quantidade: number) => {
      setQuantidades((atual) => {
        const proximo = new Map(atual);
        proximo.set(chaveQtd(p.produtoId, codigoLoja), quantidade);
        return proximo;
      });
      if (quantidade > 0) alternar(p, true);
    },
    [alternar],
  );
  const [distribuidoras, setDistribuidoras] = useState<Map<string, number[]>>(() => new Map(correcao?.distribuidoras));
  const [listaDistribuidoras, setListaDistribuidoras] = useState<Distribuidora[]>([]);
  useEffect(() => {
    apiFetch<Distribuidora[]>(`${API}/pedidos/fornecedores?busca=`)
      .then(setListaDistribuidoras)
      .catch((err: unknown) => notificar(err instanceof Error ? err : new Error("Erro ao carregar as distribuidoras.")));
  }, [notificar]);
  const definirDistribuidora = useCallback(
    (p: ProdutoLancamento, codigoLoja: number, codigos: number[]) => {
      setDistribuidoras((atual) => new Map(atual).set(chaveQtd(p.produtoId, codigoLoja), codigos));
      if (codigos.length > 0) alternar(p, true);
    },
    [alternar],
  );
  // Na edição do rascunho, começa com os produtos, quantidades e distribuidoras do Pedido (os dados de estoque vêm do ERP).
  const pedidoEditado = edicao?.pedido;
  // biome-ignore lint/correctness/useExhaustiveDependencies: só na abertura da janela.
  useEffect(() => {
    if (!pedidoEditado) return;
    const qtds = new Map<string, number>();
    const dists = new Map<string, number[]>();
    for (const i of pedidoEditado.itens) {
      for (const q of i.quantidades) {
        qtds.set(chaveQtd(i.produtoId, q.codigoLoja), q.quantidade);
        dists.set(chaveQtd(i.produtoId, q.codigoLoja), q.codigosFornecedor ?? []);
      }
    }
    setQuantidades(qtds);
    setDistribuidoras(dists);
    // Loja que o rascunho não leva fica fora da grade, para não contar como faltante.
    const comItem = new Set(pedidoEditado.itens.flatMap((i) => i.quantidades.map((q) => q.codigoLoja)));
    setLojasRemovidas(contexto.lojas.map((l) => l.codigo).filter((c) => !comItem.has(c)));
    const vazio = (i: ItemPedido): ProdutoLancamento => ({ produtoId: i.produtoId, nome: i.nome, codigoBarra: i.codigoBarra, vendida: 0, estoque: 0, minimo: 0, sugestao: 0, aChegar: 0, lojas: [] });
    const filtro = JSON.stringify(pedidoEditado.itens.map((i) => ({ tipo: "produto", id: i.produtoId })));
    const params = new URLSearchParams({ modo: "apartir", de: contexto.ontem, entradas: filtro });
    apiFetch<ProdutoLancamento[]>(`${BASE}/produtos?${params}`)
      .catch(() => [] as ProdutoLancamento[])
      .then((achados) => setSelecionados(new Map(pedidoEditado.itens.map((i) => [i.produtoId, achados.find((p) => p.produtoId === i.produtoId) ?? vazio(i)]))));
  }, []);
  const alternarLinha = useCallback((p: ProdutoLancamento) => alternar(p, !selecionados.has(p.produtoId)), [alternar, selecionados]);
  const aoGravarMinimo = useCallback(
    (produtoId: string, gravado?: MinimoGravado) => {
      if (!gravado) {
        void carregar(true);
        return;
      }
      const aplicar = (p: ProdutoLancamento) => (p.produtoId === produtoId ? comMinimoGravado(p, gravado) : p);
      setProdutos((atual) => atual.map(aplicar));
      setSelecionados((atual) => {
        const marcado = atual.get(produtoId);
        return marcado ? new Map(atual).set(produtoId, aplicar(marcado)) : atual;
      });
    },
    [carregar],
  );

  const gerarPedido = async () => {
    if (correcao) {
      const ocultas = correcao.ocultas;
      correcao.aoSalvar({ quantidades, distribuidoras, removidas: lojasRemovidas.filter((c) => !ocultas.includes(c)), marcados: [...selecionados.keys()] });
      return;
    }
    // Produto marcado com Loja em zero não passa: abre o mesmo Lançamento só com o que falta; salvar lá fecha, e salvar aqui de novo confere outra vez.
    const pendencias = pendenciasDe(selecionados.values(), quantidades, lojasRemovidas);
    if (pendencias.length > 0) {
      const faltantes = new Set(pendencias.map((x) => x.codigoLoja));
      const resultado = await windows.open<ResultadoCorrecao>({
        surface: "dialog",
        size: "screen",
        title: "Completar o Pedido",
        description: "Produtos marcados com Loja sem quantidade a pedir: informe a quantidade ou tire a Loja.",
        content: () => (
          <CorrecaoWindow
            contexto={contexto}
            correcao={{ produtos: [...new Map(pendencias.map((x) => [x.produto.produtoId, x.produto])).values()], quantidades, distribuidoras, ocultas: contexto.lojas.map((l) => l.codigo).filter((c) => !faltantes.has(c)), }}
          />
        ),
      });
      if (resultado.status === "confirmed") {
        const { quantidades: q, distribuidoras: d, removidas, marcados } = resultado.value;
        const emCorrecao = new Set(pendencias.map((x) => x.produto.produtoId));
        setQuantidades(q);
        setDistribuidoras(d);
        setLojasRemovidas((atual) => [...new Set([...atual, ...removidas])]);
        setSelecionados((atual) => new Map([...atual].filter(([id]) => !emCorrecao.has(id) || marcados.includes(id))));
      }
      return;
    }
    // A quantidade já foi digitada na grade de Lojas; só entram os produtos com alguma quantidade a pedir.
    const itens: ItemPedido[] = [...selecionados.values()]
      .map((p) => ({ produtoId: p.produtoId, nome: p.nome, codigoBarra: p.codigoBarra, quantidades: p.lojas.filter((l) => !lojasRemovidas.includes(l.codigoLoja)).map((l) => ({ codigoLoja: l.codigoLoja, quantidade: quantidades.get(chaveQtd(p.produtoId, l.codigoLoja)) ?? faltaParaMinimo(l), codigosFornecedor: distribuidoras.get(chaveQtd(p.produtoId, l.codigoLoja)) ?? [] })) }))
      .filter((i) => i.quantidades.some((q) => q.quantidade > 0));
    if (itens.length === 0) {
      notificar(new Error("Informe a quantidade a pedir de ao menos um produto."));
      return;
    }
    try {
      if (edicao) {
        const salvo = await apiFetch<Pedido>(`${PEDIDOS_BASE}/${edicao.pedido.id}`, json("PUT", { itens, version: edicao.pedido.version }));
        feedback.notify({ type: "success", title: "Rascunho salvo." });
        edicao.aoSalvar(salvo);
        return;
      }
      await apiFetch(PEDIDOS_BASE, json("POST", { itens }));
      feedback.notify({ type: "success", title: "Pedido gerado em rascunho." });
      setSelecionados(new Map());
      setQuantidades(new Map());
      setDistribuidoras(new Map());
    } catch (err: unknown) {
      notificar(err instanceof Error ? err : new Error(edicao ? "Erro ao salvar o rascunho." : "Erro ao gerar o Pedido."));
    }
  };

  // Estável entre movimentos do cursor: só muda ao marcar produtos (a coluna de seleção lê `selecionados`).
  // A ordem por seleção vale pelo que estava marcado ao clicar no cabeçalho: marcar depois não sobe a linha junto.
  const [ordemSelecao, setOrdemSelecao] = useState<ReadonlySet<string>>(new Set());
  const colunas = useMemo<DataTableColumn<ProdutoLancamento>[]>(() => [
      {
        key: "selecionar",
        label: "",
        render: (p) => (
          <Stack direction="row" justify="center">
            <Checkbox aria-label={`Selecionar ${p.nome}`} checked={selecionados.has(p.produtoId)} onCheckedChange={(v: boolean) => alternar(p, v)} />
          </Stack>
        ),
        width: 28,
        centered: true,
        value: (p) => (ordemSelecao.has(p.produtoId) ? 1 : 0),
        sortable: true,
        firstSort: "desc",
        cellClassName: "px-0!",
        mobileRole: "hidden",
      },
      { key: "codigo", label: "Código", value: (p) => p.codigoProduto ?? "", searchable: true, sortable: true, cellClassName: "font-mono text-xs" },
      { key: "nome", label: "Produto", value: (p) => p.nome, searchable: true, sortable: true, truncateAt: 32, mobileRole: "primary" },
      { key: "fabricante", label: "Fabricante", value: (p) => p.fabricante ?? "", sortable: true, searchable: true, truncateAt: 16 },
      { key: "formula", label: "Fórmula", value: (p) => p.formula ?? "", sortable: true, truncateAt: 16 },
      { key: "grupo", label: "Grupo", value: (p) => p.grupo ?? "", sortable: true, truncateAt: 14 },
      { key: "secao", label: "Seção", value: (p) => p.secao ?? "", sortable: true, truncateAt: 14 },
      { key: "codigoBarra", label: "Cód. barras", tooltip: "Código de barras", value: (p) => p.codigoBarra ?? "", searchable: true },
  ], [selecionados, ordemSelecao, alternar]);

  const emFoco = useMemo(() => (ativo ? produtos.find((p) => p.produtoId === ativo) : undefined), [ativo, produtos]);

  // Todo produto marcado ou em foco já traz as distribuidoras que deram entrada nele (uma consulta por produto; o que o usuário já escolheu fica).
  const idEmFoco = emFoco?.produtoId;
  const jaConsultados = useRef(new Set<string>());
  const idsMarcados = [...selecionados.keys()].sort().join(",");
  useEffect(() => {
    const ids = [...new Set([...(idEmFoco ? [idEmFoco] : []), ...idsMarcados.split(",").filter(Boolean)])].filter((id) => !jaConsultados.current.has(id)).slice(0, 200);
    if (ids.length === 0) return;
    for (const id of ids) jaConsultados.current.add(id);
    apiFetch<{ produtoId: string; codigoLoja: number; codigoFornecedor: number }[]>(`${BASE}/entradas?produtoIds=${encodeURIComponent(ids.join(","))}`)
      .then((entradas) =>
        setDistribuidoras((atual) => {
          const proximo = new Map(atual);
          for (const e of entradas) {
            const chave = chaveQtd(e.produtoId, e.codigoLoja);
            if (atual.has(chave)) continue;
            proximo.set(chave, [...(proximo.get(chave) ?? []), e.codigoFornecedor]);
          }
          return proximo;
        }),
      )
      .catch(() => {
        for (const id of ids) jaConsultados.current.delete(id);
      });
  }, [idEmFoco, idsMarcados]);

  return (
    <Stack gap="field" viewport={edicao || correcao ? "modal" : true}>
      <Stack direction="row" gap="group" align="center" shrink={false}>
        {abas}
        <Stack grow>
          <Text variant="caption" tone="muted" truncate>
            {correcao ? "Só os produtos e Lojas que faltam" : resumo(aplicados ?? padrao)}
          </Text>
        </Stack>
        <Text variant="caption" tone="muted">
          {formatNumber(selecionados.size)} {selecionados.size === 1 ? "produto selecionado" : "produtos selecionados"}
        </Text>
        <Button type="button" disabled={selecionados.size === 0} onClick={() => void gerarPedido()}>
          {edicao ? "Salvar rascunho" : correcao ? "Salvar" : "Gerar pedido"}
        </Button>
      </Stack>
      <Grid columns="workspace" gap="tight">
        <Stack grow>
          <DataTable
            scroll="fill"
            title="Produtos"
            headerActions={
              correcao ? undefined : (
                <Button type="button" variant="outline" onClick={() => void abrirFiltros()}>
                  <SlidersHorizontal />
                  Filtros
                </Button>
              )
            }
            compact
            columns={colunas}
            rows={produtos}
            getRowId={idProduto}
            loading={carregando}
            markedRow={(p) => selecionados.has(p.produtoId)}
            activeRowId={ativo}
            onActiveRowChange={setAtivo}
            onRowToggle={alternarLinha}
            search={BUSCA_PRODUTO}
            onSortChange={(chave) => chave === "selecionar" && setOrdemSelecao(new Set(selecionados.keys()))}
            emptyMessage="Nenhuma venda no período e filtros escolhidos."
          />
        </Stack>
        <Detalhe produto={emFoco} contexto={contexto} lojasFiltro={aplicados?.lojas ?? padrao.lojas} onSalvo={aoGravarMinimo} quantidades={quantidades} onQuantidade={definirQuantidade} distribuidoras={distribuidoras} listaDistribuidoras={listaDistribuidoras} onDistribuidora={definirDistribuidora} removidas={lojasRemovidas} onRemovidas={setLojasRemovidas} />
      </Grid>
    </Stack>
  );
}
