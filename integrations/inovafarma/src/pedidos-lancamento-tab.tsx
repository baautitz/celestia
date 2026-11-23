import { memo, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@platform/ui/components/button";
import { Checkbox } from "@platform/ui/components/checkbox";
import { Combobox, ComboboxInput, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList, ComboboxValue, useComboboxAnchor } from "@platform/ui/components/combobox";
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
import { API } from "./inovafarma-api";
import { ListaProdutosCampo } from "./lista-produtos-campo";
import type { EntradaLista } from "./tipos-meta";
import { PedidoRascunhoWindow, type ItemPedido } from "./pedido-rascunho-window";
import type { LojaOpcao } from "./loja-opcao";
import { useLatestFetch } from "./use-latest-fetch";
import type { VisaoPedidos } from "./pedidos-visoes";
import { BASE_VISOES, PedidosVisoesBarra } from "./pedidos-visoes-barra";

const BASE = `${API}/pedidos/lancamento`;
/** Pausa do cursor antes de consultar a movimentação do produto em foco. */
const ESPERA_DETALHE_MS = 180;
const idProduto = (p: ProdutoLancamento) => p.produtoId;
const idLoja = (l: LinhaLoja) => String(l.codigoLoja);
const idMes = (m: Mes) => m.mes;
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
  nome: string;
  codigoBarra: string | null;
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

const COLUNAS_MES: DataTableColumn<Mes>[] = [
  { key: "mes", label: "Mês", value: (m) => mesBr(m.mes) },
  { key: "vendida", label: "Venda", format: "decimal", value: (m) => m.vendida },
  { key: "comprada", label: "Compra", format: "decimal", value: (m) => m.comprada },
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
  const lojas = produto.lojas.map((l) => (l.codigoLoja === gravado.codigoLoja ? { ...l, minimo: gravado.minimo, maximo: gravado.maximo, version: gravado.version, sugestao: Math.max(0, l.vendida + gravado.minimo - l.estoque) } : l));
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

interface Distribuidora {
  codigo: number;
  nome: string;
}

/** Célula da distribuidora da Loja: busca na lista do ERP e guarda o código escolhido. */
function CampoDistribuidora({ valor, lista, rotulo, onChange }: { valor: number | undefined; lista: Distribuidora[]; rotulo: string; onChange: (codigo: number | null) => void }) {
  return (
    <Combobox
      autoHighlight
      items={lista}
      value={lista.find((d) => d.codigo === valor) ?? null}
      onValueChange={(d: Distribuidora | null) => onChange(d?.codigo ?? null)}
      itemToStringLabel={(d: Distribuidora) => d.nome}
      itemToStringValue={(d: Distribuidora) => String(d.codigo)}
      isItemEqualToValue={(a: Distribuidora, b: Distribuidora) => a.codigo === b.codigo}
    >
      <ComboboxInput aria-label={rotulo} placeholder="Distribuidora" showClear inTableCell />
      <ComboboxContent wide>
        <ComboboxEmpty>Nenhuma distribuidora encontrada.</ComboboxEmpty>
        <ComboboxList>
          {(d: Distribuidora) => (
            <ComboboxItem key={d.codigo} value={d}>
              {d.nome}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/** Campo de mínimo/máximo estreito e à direita, para a tabela de Lojas caber sem rolagem lateral. */
const CAMPO_LOJA = "[&_input]:w-14 [&_input]:px-1.5 [&_input]:text-right";

const Detalhe = memo(function Detalhe({ produto, contexto, lojasFiltro, onSalvo, quantidades, onQuantidade, distribuidoras, listaDistribuidoras, onDistribuidora }: { produto: ProdutoLancamento | undefined; contexto: Contexto; lojasFiltro: number[]; onSalvo: (produtoId: string, gravado?: MinimoGravado) => void; quantidades: Map<string, number>; onQuantidade: (produto: ProdutoLancamento, codigoLoja: number, quantidade: number) => void; distribuidoras: Map<string, number>; listaDistribuidoras: Distribuidora[]; onDistribuidora: (produto: ProdutoLancamento, codigoLoja: number, codigo: number | null) => void }) {
  const { feedback } = useUi();
  const novaConsulta = useLatestFetch();
  const [meses, setMeses] = useState<Mes[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [lojaAtiva, setLojaAtiva] = useState<string | null>(null);
  const [apenasLoja, setApenasLoja] = useState(true);

  const codigoLoja = apenasLoja && produto?.lojas.some((l) => String(l.codigoLoja) === lojaAtiva) ? lojaAtiva : null;
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

  const produtoId = produto?.produtoId ?? "";
  const colunasLoja = useMemo<DataTableColumn<LinhaLoja>[]>(() => {
    const nomeLoja = (codigo: number) => contexto.lojas.find((l) => l.codigo === codigo)?.nome || `Loja ${codigo}`;
    return [
    { key: "loja", label: "Loja", value: (l) => nomeLoja(l.codigoLoja) },
    { key: "estoque", label: "Estoque", tooltip: "Estoque atual", format: "decimal", value: (l) => l.estoque },
    { key: "vendida", label: "Vendida", tooltip: "Qtde vendida", format: "decimal", value: (l) => l.vendida },
    contexto.podeEditarMinimos
      ? { key: "minimo", label: "Mín.", tooltip: "Estoque mínimo", format: "decimal", render: (l) => <CampoMinimoMaximo linha={l} produtoId={produtoId} campo="minimo" rotulo={`Estoque mínimo da Loja ${nomeLoja(l.codigoLoja)}`} onSalvo={onSalvo} />, cellClassName: CAMPO_LOJA, mobileWide: true }
      : { key: "minimo", label: "Mín.", tooltip: "Estoque mínimo", format: "decimal", value: (l) => l.minimo ?? 0 },
    contexto.podeEditarMinimos
      ? { key: "maximo", label: "Máx.", tooltip: "Estoque máximo", format: "decimal", render: (l) => <CampoMinimoMaximo linha={l} produtoId={produtoId} campo="maximo" rotulo={`Estoque máximo da Loja ${nomeLoja(l.codigoLoja)}`} onSalvo={onSalvo} />, cellClassName: CAMPO_LOJA, mobileWide: true }
      : { key: "maximo", label: "Máx.", tooltip: "Estoque máximo", format: "decimal", value: (l) => l.maximo ?? 0 },
    { key: "sugestao", label: "Sug.", tooltip: "Sugestão", format: "decimal", value: (l) => l.sugestao },
    { key: "aChegar", label: "A chegar", format: "decimal", value: (l) => l.aChegar },
    { key: "pedir", label: "Pedir", tooltip: "Quantidade a pedir", format: "decimal", render: (l) => <CampoPedir valor={quantidades.get(chaveQtd(produtoId, l.codigoLoja))} rotulo={`Quantidade a pedir da Loja ${nomeLoja(l.codigoLoja)}`} onChange={(q) => produto && onQuantidade(produto, l.codigoLoja, q)} />, cellClassName: CAMPO_LOJA, mobileWide: true },
    { key: "distribuidora", label: "Distribuidora", render: (l) => <CampoDistribuidora valor={distribuidoras.get(chaveQtd(produtoId, l.codigoLoja))} lista={listaDistribuidoras} rotulo={`Distribuidora da Loja ${nomeLoja(l.codigoLoja)}`} onChange={(c) => produto && onDistribuidora(produto, l.codigoLoja, c)} />, mobileWide: true },
    ];
  }, [contexto.lojas, contexto.podeEditarMinimos, produtoId, produto, onSalvo, quantidades, onQuantidade, distribuidoras, listaDistribuidoras, onDistribuidora]);
  const colunasMes = COLUNAS_MES;
  const vazio = "Selecione um produto para ver o estoque e as vendas por Loja e a movimentação mensal.";
  return (
    <>
      <Stack grow>
        <DataTable scroll="fill" compact title={produto ? `Lojas: ${produto.nome}` : "Lojas"} columns={colunasLoja} rows={produto?.lojas ?? []} getRowId={idLoja} activeRowId={lojaAtiva} onActiveRowChange={setLojaAtiva} emptyMessage={produto ? "Nenhuma Loja." : vazio} />
      </Stack>
      <Stack grow span="full">
        <DataTable
          scroll="fill"
          compact
          headerActions={
            <Stack direction="row" gap="field" align="center" shrink={false}>
              <Checkbox id="pedidos-apenas-loja" checked={apenasLoja} onCheckedChange={(v: boolean) => setApenasLoja(v)} />
              <Label htmlFor="pedidos-apenas-loja">Apenas a Loja selecionada</Label>
            </Stack>
          }
          title={produto ? `Movimentação mensal: ${produto.nome}` : "Movimentação mensal"} columns={colunasMes} rows={meses} getRowId={idMes} loading={carregando} emptyMessage={produto ? "Sem vendas nem compras nos últimos 12 meses." : vazio} />
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

function Lancamento({ contexto, notificar, abas }: { contexto: Contexto; notificar: (e: Error) => void; abas: ReactNode }) {
  const { windows } = useUi();
  const novaConsulta = useLatestFetch();
  const [visoes, setVisoes] = useState<VisaoPedidos[]>([]);
  const [visao, setVisao] = useState<string | null>(null);
  const [produtos, setProdutos] = useState<ProdutoLancamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  // A seleção sobrevive aos filtros: guarda o produto inteiro, para o detalhe não depender da grade atual.
  const [selecionados, setSelecionados] = useState<ReadonlyMap<string, ProdutoLancamento>>(new Map());
  // O cursor da grade (linha ativa) é o que o detalhe mostra; os marcados só alimentam o "Gerar pedido".
  const [ativo, setAtivo] = useState<string | null>(null);
  // Os filtros só valem na consulta depois de "Filtrar" no sheet; a primeira consulta espera as visões e usa a padrão.
  const [aplicados, setAplicados] = useState<FiltrosAplicados | null>(null);
  const padrao: FiltrosAplicados = { modo: "apartir", de: contexto.ontem, ate: contexto.ontem, lojas: [], entradas: [], apenasMinimo: false };

  // biome-ignore lint/correctness/useExhaustiveDependencies: só na abertura da aba; depois as visões recarregam dentro do sheet.
  useEffect(() => {
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
  // Quantidade a pedir digitada na grade de Lojas; digitar marca o produto.
  const [quantidades, setQuantidades] = useState<Map<string, number>>(() => new Map());
  const definirQuantidade = useCallback(
    (p: ProdutoLancamento, codigoLoja: number, quantidade: number) => {
      setQuantidades((atual) => {
        const proximo = new Map(atual);
        if (quantidade > 0) proximo.set(chaveQtd(p.produtoId, codigoLoja), quantidade);
        else proximo.delete(chaveQtd(p.produtoId, codigoLoja));
        return proximo;
      });
      if (quantidade > 0) alternar(p, true);
    },
    [alternar],
  );
  const [distribuidoras, setDistribuidoras] = useState<Map<string, number>>(() => new Map());
  const [listaDistribuidoras, setListaDistribuidoras] = useState<Distribuidora[]>([]);
  useEffect(() => {
    apiFetch<Distribuidora[]>(`${API}/pedidos/fornecedores?busca=`)
      .then(setListaDistribuidoras)
      .catch((err: unknown) => notificar(err instanceof Error ? err : new Error("Erro ao carregar as distribuidoras.")));
  }, [notificar]);
  const definirDistribuidora = useCallback(
    (p: ProdutoLancamento, codigoLoja: number, codigo: number | null) => {
      setDistribuidoras((atual) => {
        const proximo = new Map(atual);
        if (codigo !== null) proximo.set(chaveQtd(p.produtoId, codigoLoja), codigo);
        else proximo.delete(chaveQtd(p.produtoId, codigoLoja));
        return proximo;
      });
      if (codigo !== null) alternar(p, true);
    },
    [alternar],
  );
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
    // A quantidade vem digitada na janela; o produto entra com todas as Lojas que ele tem na consulta.
    const itens: ItemPedido[] = [...selecionados.values()].map((p) => ({ produtoId: p.produtoId, nome: p.nome, codigoBarra: p.codigoBarra, quantidades: p.lojas.map((l) => ({ codigoLoja: l.codigoLoja, quantidade: quantidades.get(chaveQtd(p.produtoId, l.codigoLoja)) ?? 0, codigoFornecedor: distribuidoras.get(chaveQtd(p.produtoId, l.codigoLoja)) ?? null })) }));
    const resultado = await windows.open<unknown>({
      surface: "dialog",
      size: "full",
      title: "Gerar pedido",
      description: "Digite a quantidade de cada produto por Loja. O Pedido fica em rascunho.",
      content: () => <PedidoRascunhoWindow itens={itens} lojas={contexto.lojas} />,
    });
    if (resultado.status === "confirmed") {
      setSelecionados(new Map());
      setQuantidades(new Map());
      setDistribuidoras(new Map());
    }
  };

  // Estável entre movimentos do cursor: só muda ao marcar produtos (a coluna de seleção lê `selecionados`).
  const colunas = useMemo<DataTableColumn<ProdutoLancamento>[]>(() => [
      {
        key: "selecionar",
        label: "",
        render: (p) => <Checkbox aria-label={`Selecionar ${p.nome}`} checked={selecionados.has(p.produtoId)} onCheckedChange={(v: boolean) => alternar(p, v)} />,
        mobileRole: "hidden",
      },
      { key: "nome", label: "Produto", value: (p) => p.nome, searchable: true, sortable: true, mobileRole: "primary" },
      { key: "estoque", label: "Estoque", tooltip: "Estoque atual", format: "decimal", value: (p) => p.estoque, sortable: true },
      { key: "vendida", label: "Vendida", tooltip: "Qtde vendida", format: "decimal", value: (p) => p.vendida, sortable: true, firstSort: "desc" },
      { key: "minimo", label: "Mínimo", tooltip: "Estoque mínimo", format: "decimal", value: (p) => p.minimo, sortable: true },
      { key: "sugestao", label: "Sugestão", format: "decimal", value: (p) => p.sugestao, sortable: true },
      { key: "aChegar", label: "A chegar", format: "decimal", value: (p) => p.aChegar, sortable: true },
      { key: "codigoBarra", label: "Cód. barras", tooltip: "Código de barras", value: (p) => p.codigoBarra ?? "", searchable: true },
  ], [selecionados, alternar]);

  const emFoco = useMemo(() => (ativo ? produtos.find((p) => p.produtoId === ativo) : undefined), [ativo, produtos]);

  return (
    <Stack gap="field" viewport>
      <Stack direction="row" gap="group" align="center" shrink={false}>
        {abas}
        <Stack grow>
          <Text variant="caption" tone="muted" truncate>
            {resumo(aplicados ?? padrao)}
          </Text>
        </Stack>
        <Text variant="caption" tone="muted">
          {formatNumber(selecionados.size)} {selecionados.size === 1 ? "produto selecionado" : "produtos selecionados"}
        </Text>
        <Button type="button" disabled={selecionados.size === 0} onClick={() => void gerarPedido()}>
          Gerar pedido
        </Button>
      </Stack>
      <Grid columns="workspace" gap="tight">
        <Stack grow>
          <DataTable
            scroll="fill"
            title="Produtos"
            headerActions={
              <Button type="button" variant="outline" onClick={() => void abrirFiltros()}>
                <SlidersHorizontal />
                Filtros
              </Button>
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
            emptyMessage="Nenhuma venda no período e filtros escolhidos."
          />
        </Stack>
        <Detalhe produto={emFoco} contexto={contexto} lojasFiltro={aplicados?.lojas ?? padrao.lojas} onSalvo={aoGravarMinimo} quantidades={quantidades} onQuantidade={definirQuantidade} distribuidoras={distribuidoras} listaDistribuidoras={listaDistribuidoras} onDistribuidora={definirDistribuidora} />
      </Grid>
    </Stack>
  );
}
