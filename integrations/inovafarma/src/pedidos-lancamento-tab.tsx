import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Checkbox } from "@platform/ui/components/checkbox";
import { Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList, ComboboxValue, useComboboxAnchor } from "@platform/ui/components/combobox";
import { DatePicker } from "@platform/ui/components/date-picker";
import { DateRangePicker } from "@platform/ui/components/date-range-picker";
import { Label } from "@platform/ui/components/label";
import { Stack, Text } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { formatNumber } from "@platform/ui/lib/format";
import { FalhaAoCarregar, useContexto } from "./contexto";
import { API } from "./inovafarma-api";
import type { LojaOpcao } from "./loja-opcao";
import { useLatestFetch } from "./use-latest-fetch";
import type { VisaoPedidos } from "./pedidos-visoes";
import { BASE_VISOES, PedidosVisoesBarra } from "./pedidos-visoes-barra";

const BASE = `${API}/pedidos/lancamento`;
const TODOS = "todos";

interface Opcao {
  id: string;
  nome: string;
}

interface Contexto {
  hoje: string;
  ontem: string;
  lojas: LojaOpcao[];
  laboratorios: Opcao[];
  grupos: Opcao[];
  secoes: Opcao[];
  /** Listas de produtos prontas. */
  listas: Opcao[];
}

interface LinhaLoja {
  codigoLoja: number;
  vendida: number;
  estoque: number;
}

export interface ProdutoLancamento {
  produtoId: string;
  nome: string;
  codigoBarra: string | null;
  vendida: number;
  estoque: number;
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

function FiltroOpcao({ rotulo, opcoes, valor, onChange }: { rotulo: string; opcoes: Opcao[]; valor: string; onChange: (id: string) => void }) {
  return (
    <Stack gap="field">
      <Label>{rotulo}</Label>
      <Select value={valor} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger aria-label={rotulo}>
          <SelectValue>{(v: string) => (v === TODOS ? "Todos" : (opcoes.find((o) => o.id === v)?.nome ?? v))}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos</SelectItem>
          {opcoes.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Stack>
  );
}

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

function FiltroListas({ listas, escolhidas, onChange }: { listas: Opcao[]; escolhidas: string[]; onChange: (ids: string[]) => void }) {
  const ancora = useComboboxAnchor();
  return (
    <Stack gap="field">
      <Label htmlFor="pedidos-listas">Listas de produtos</Label>
      <Combobox
        multiple
        autoHighlight
        items={listas}
        value={listas.filter((l) => escolhidas.includes(l.id))}
        onValueChange={(v: Opcao[]) => onChange(v.map((l) => l.id))}
        itemToStringLabel={(l: Opcao) => l.nome}
        itemToStringValue={(l: Opcao) => l.id}
        isItemEqualToValue={(a: Opcao, b: Opcao) => a.id === b.id}
      >
        <ComboboxChips ref={ancora}>
          <ComboboxValue>
            {(v: Opcao[]) => (
              <>
                {v.map((l) => (
                  <ComboboxChip key={l.id}>{l.nome}</ComboboxChip>
                ))}
                <ComboboxChipsInput id="pedidos-listas" aria-label="Listas de produtos" placeholder={v.length === 0 ? "Todos os produtos" : ""} />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent anchor={ancora}>
          <ComboboxEmpty>Nenhuma lista pronta.</ComboboxEmpty>
          <ComboboxList>
            {(l: Opcao) => (
              <ComboboxItem key={l.id} value={l}>
                {l.nome}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Stack>
  );
}

function Detalhe({ produto, contexto, lojasFiltro }: { produto: ProdutoLancamento; contexto: Contexto; lojasFiltro: number[] }) {
  const { feedback } = useUi();
  const novaConsulta = useLatestFetch();
  const [meses, setMeses] = useState<Mes[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    const vale = novaConsulta();
    setCarregando(true);
    const params = new URLSearchParams({ produtoId: produto.produtoId });
    if (lojasFiltro.length) params.set("lojas", lojasFiltro.join(","));
    apiFetch<Mes[]>(`${BASE}/movimentacao?${params}`)
      .then((r) => vale() && setMeses(r))
      .catch((err: unknown) => {
        if (!vale()) return;
        setMeses([]);
        feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar a movimentação mensal."));
      })
      .finally(() => vale() && setCarregando(false));
  }, [produto.produtoId, lojasFiltro, feedback, novaConsulta]);

  const nomeLoja = (codigo: number) => contexto.lojas.find((l) => l.codigo === codigo)?.nome || `Loja ${codigo}`;
  const colunasLoja: DataTableColumn<LinhaLoja>[] = [
    { key: "loja", label: "Loja", value: (l) => nomeLoja(l.codigoLoja) },
    { key: "estoque", label: "Estoque atual", format: "decimal", value: (l) => l.estoque },
    { key: "vendida", label: "Qtde vendida", format: "decimal", value: (l) => l.vendida },
  ];
  const colunasMes: DataTableColumn<Mes>[] = [
    { key: "mes", label: "Mês", value: (m) => mesBr(m.mes) },
    { key: "vendida", label: "Venda", format: "decimal", value: (m) => m.vendida },
    { key: "comprada", label: "Compra", format: "decimal", value: (m) => m.comprada },
  ];
  return (
    <Stack gap="section">
      <DataTable title={`Lojas: ${produto.nome}`} columns={colunasLoja} rows={produto.lojas} getRowId={(l) => String(l.codigoLoja)} emptyMessage="Nenhuma Loja." />
      <DataTable title={`Movimentação mensal: ${produto.nome}`} columns={colunasMes} rows={meses} getRowId={(m) => m.mes} loading={carregando} emptyMessage="Sem vendas nem compras nos últimos 12 meses." />
    </Stack>
  );
}

/** Aba Lançamento: filtros, grade de produtos com seleção e, do produto em foco, as Lojas e a movimentação mensal. */
export function PedidosLancamentoTab() {
  const { feedback } = useUi();
  const { contexto, falha, carregar } = useContexto<Contexto>(`${BASE}/contexto`, "Erro ao carregar o Lançamento de Pedidos.");
  if (!contexto) {
    return falha ? (
      <FalhaAoCarregar titulo="Não foi possível carregar o Lançamento de Pedidos" descricao={falha} onTentarNovamente={() => void carregar()} />
    ) : null;
  }
  return <Lancamento contexto={contexto} notificar={feedback.notifyError} />;
}

function Lancamento({ contexto, notificar }: { contexto: Contexto; notificar: (e: Error) => void }) {
  const novaConsulta = useLatestFetch();
  const [modo, setModo] = useState<Modo>("periodo");
  const [de, setDe] = useState(contexto.ontem);
  const [ate, setAte] = useState(contexto.ontem);
  const [lojas, setLojas] = useState<number[]>([]);
  const [laboratorio, setLaboratorio] = useState(TODOS);
  const [grupo, setGrupo] = useState(TODOS);
  const [secao, setSecao] = useState(TODOS);
  const [listas, setListas] = useState<string[]>([]);
  const [apenasComMinimo, setApenasComMinimo] = useState(false);
  const [visoes, setVisoes] = useState<VisaoPedidos[]>([]);
  const [visao, setVisao] = useState<string | null>(null);
  // A primeira consulta de produtos espera as visões: a padrão já entra nos filtros, sem consulta dupla.
  const [visoesProntas, setVisoesProntas] = useState(false);
  const [produtos, setProdutos] = useState<ProdutoLancamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  // A seleção sobrevive aos filtros: guarda o produto inteiro, para o detalhe não depender da grade atual.
  const [selecionados, setSelecionados] = useState<ReadonlyMap<string, ProdutoLancamento>>(new Map());
  const [foco, setFoco] = useState<string | null>(null);

  /** Aplica os filtros de uma visão (ou limpa); a data não muda. Lojas e listas que sumiram ficam de fora. */
  const aplicarVisao = useCallback(
    (v: VisaoPedidos | null) => {
      setVisao(v?.id ?? null);
      if (!v) return;
      setLojas(v.lojas.filter((codigo) => contexto.lojas.some((l) => l.codigo === codigo)));
      setListas(v.listas.filter((id) => contexto.listas.some((l) => l.id === id)));
      setLaboratorio(v.laboratorio ?? TODOS);
      setGrupo(v.grupo ?? TODOS);
      setSecao(v.secao ?? TODOS);
      setApenasComMinimo(v.apenasComMinimo);
    },
    [contexto],
  );

  const carregarVisoes = useCallback(
    async (salva?: VisaoPedidos, inicial = false) => {
      try {
        const lista = await apiFetch<VisaoPedidos[]>(BASE_VISOES);
        setVisoes(lista);
        if (inicial) aplicarVisao(lista.find((v) => v.padrao) ?? null);
        else if (salva) setVisao(salva.id);
      } catch (err: unknown) {
        notificar(err instanceof Error ? err : new Error("Erro ao carregar as visões."));
      } finally {
        if (inicial) setVisoesProntas(true);
      }
    },
    [aplicarVisao, notificar],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: só na abertura da aba; depois as visões recarregam por `onMudou`.
  useEffect(() => {
    void carregarVisoes(undefined, true);
  }, []);

  const carregar = useCallback(async () => {
    if (!visoesProntas) return;
    const vale = novaConsulta();
    const params = new URLSearchParams({ modo, de });
    if (modo === "periodo") params.set("ate", ate);
    if (lojas.length) params.set("lojas", lojas.join(","));
    if (laboratorio !== TODOS) params.set("laboratorio", laboratorio);
    if (grupo !== TODOS) params.set("grupo", grupo);
    if (secao !== TODOS) params.set("secao", secao);
    if (listas.length) params.set("listas", listas.join(","));
    setCarregando(true);
    try {
      const r = await apiFetch<ProdutoLancamento[]>(`${BASE}/produtos?${params}`);
      if (vale()) setProdutos(r);
    } catch (err: unknown) {
      if (vale()) {
        setProdutos([]);
        notificar(err instanceof Error ? err : new Error("Erro ao carregar os produtos."));
      }
    } finally {
      if (vale()) setCarregando(false);
    }
  }, [visoesProntas, modo, de, ate, lojas, laboratorio, grupo, secao, listas, notificar, novaConsulta]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const alternar = (p: ProdutoLancamento, marcado: boolean) => {
    setSelecionados((atual) => {
      const proximo = new Map(atual);
      if (marcado) proximo.set(p.produtoId, p);
      else proximo.delete(p.produtoId);
      return proximo;
    });
    setFoco((atual) => (marcado ? p.produtoId : atual === p.produtoId ? null : atual));
  };

  const colunas: DataTableColumn<ProdutoLancamento>[] = [
      {
        key: "selecionar",
        label: "",
        render: (p) => <Checkbox aria-label={`Selecionar ${p.nome}`} checked={selecionados.has(p.produtoId)} onCheckedChange={(v: boolean) => alternar(p, v)} />,
        mobileRole: "hidden",
      },
      { key: "nome", label: "Produto", value: (p) => p.nome, searchable: true, sortable: true, mobileRole: "primary" },
      { key: "codigoBarra", label: "Código de barras", value: (p) => p.codigoBarra ?? "", searchable: true },
      { key: "estoque", label: "Estoque atual", format: "decimal", value: (p) => p.estoque, sortable: true },
      { key: "vendida", label: "Qtde vendida", format: "decimal", value: (p) => p.vendida, sortable: true, firstSort: "desc" },
  ];

  const emFoco = foco ? (produtos.find((p) => p.produtoId === foco) ?? selecionados.get(foco)) : undefined;

  return (
    <Stack gap="section">
      <Stack surface="card" gap="group">
        <Stack direction="row" gap="group" wrap>
          <Stack gap="field">
            <Label>Data</Label>
            <Select value={modo} onValueChange={(v) => v && setModo(v as Modo)}>
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
                  setDe(paraIso(r.from));
                  setAte(paraIso(r.to));
                }}
              />
            ) : (
              <DatePicker value={paraDia(de)} onChange={(d) => d && setDe(paraIso(d))} />
            )}
          </Stack>
        </Stack>
        <PedidosVisoesBarra
          visoes={visoes}
          selecionada={visao}
          filtros={{ lojas, listas, laboratorio: laboratorio === TODOS ? null : laboratorio, grupo: grupo === TODOS ? null : grupo, secao: secao === TODOS ? null : secao, apenasComMinimo }}
          onAplicar={aplicarVisao}
          onMudou={(salva) => void carregarVisoes(salva)}
        />
        <FiltroLojas lojas={contexto.lojas} escolhidas={lojas} onChange={setLojas} />
        <FiltroListas listas={contexto.listas} escolhidas={listas} onChange={setListas} />
        <Stack direction="row" gap="group" wrap>
          <FiltroOpcao rotulo="Laboratório" opcoes={contexto.laboratorios} valor={laboratorio} onChange={setLaboratorio} />
          <FiltroOpcao rotulo="Grupo" opcoes={contexto.grupos} valor={grupo} onChange={setGrupo} />
          <FiltroOpcao rotulo="Seção" opcoes={contexto.secoes} valor={secao} onChange={setSecao} />
        </Stack>
        {/* O mínimo entra em Pedidos com o Estoque Mínimo: por ora a visão só guarda a marca. */}
        <Stack direction="row" gap="field" align="center">
          <Checkbox id="pedidos-apenas-minimo" checked={apenasComMinimo} onCheckedChange={(v: boolean) => setApenasComMinimo(v)} />
          <Label htmlFor="pedidos-apenas-minimo">Apenas com mínimo</Label>
        </Stack>
      </Stack>
      <Text variant="caption" tone="muted">
        {formatNumber(selecionados.size)} {selecionados.size === 1 ? "produto selecionado" : "produtos selecionados"}
      </Text>
      <DataTable
        title="Produtos"
        columns={colunas}
        rows={produtos}
        getRowId={(p) => p.produtoId}
        loading={carregando}
        search={{ placeholder: "Buscar produto" }}
        emptyMessage="Nenhuma venda no período e filtros escolhidos."
      />
      {emFoco ? (
        <Detalhe produto={emFoco} contexto={contexto} lojasFiltro={lojas} />
      ) : (
        <Alert>
          <AlertTitle>Nenhum produto em foco</AlertTitle>
          <AlertDescription>Marque um produto para ver o estoque e as vendas por Loja e a movimentação mensal.</AlertDescription>
        </Alert>
      )}
    </Stack>
  );
}
