import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@platform/ui/components/button";
import { Checkbox } from "@platform/ui/components/checkbox";
import { Grid, Stack, Text } from "@platform/ui/components/layout";
import { SeriesChart } from "@platform/ui/components/series-chart";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { formatNumber } from "@platform/ui/lib/format";
import { API } from "./inovafarma-api";
import type { LojaOpcao } from "./loja-opcao";

/** O que o estudo precisa de cada produto da grade (o que o Lançamento já carregou). */
export interface ProdutoDoEstudo {
  produtoId: string;
  nome: string;
  lojas: { codigoLoja: number; vendida: number; estoque: number; minimo: number | null; sugestao: number; aChegar: number }[];
}

interface VendaDoMes { mes: string; codigoLoja: number; vendida: number }
interface CompraDoMes { mes: string; codigoLoja: number; codigoFornecedor: number; fornecedor: string; quantidade: number; valor: number }
interface Estudo { hoje: string; vendas: VendaDoMes[] | null; compras: CompraDoMes[] | null }

const MESES = 24;
/** Distribuidoras desenhadas nos gráficos (as de mais volume); as demais seguem nas tabelas. */
const MAX_SERIES = 5;
const DIAS_DA_COBERTURA = 90;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const mesBr = (mes: string) => mes.split("-").reverse().join("/");
/** `AAAA-MM` como `MM/AA`, para caberem os 24 meses no eixo do gráfico. */
const mesCurto = (mes: string) => `${mes.slice(5)}/${mes.slice(2, 4)}`;
const ultimosMeses = (hoje: string): string[] => {
  const [ano = 0, mes = 1] = hoje.split("-").map(Number);
  return Array.from({ length: MESES }, (_, i) => {
    const d = new Date(Date.UTC(ano, mes - MESES + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
};
const decimal = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const dinheiro = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Distribuidora { codigo: number; nome: string; quantidade: number; valor: number; meses: Map<string, { quantidade: number; valor: number }> }

function porDistribuidora(compras: CompraDoMes[]): Distribuidora[] {
  const mapa = new Map<number, Distribuidora>();
  for (const c of compras) {
    const d = mapa.get(c.codigoFornecedor) ?? { codigo: c.codigoFornecedor, nome: c.fornecedor, quantidade: 0, valor: 0, meses: new Map() };
    d.quantidade += c.quantidade;
    d.valor += c.valor;
    const m = d.meses.get(c.mes) ?? { quantidade: 0, valor: 0 };
    m.quantidade += c.quantidade;
    m.valor += c.valor;
    d.meses.set(c.mes, m);
    mapa.set(c.codigoFornecedor, d);
  }
  return [...mapa.values()].sort((a, b) => b.quantidade - a.quantidade);
}

interface LinhaDistribuidora { codigo: number; nome: string; quantidade: number; valor: number; medio: number; ultimo: string; ultimoCusto: number; menor: number; maior: number }
interface LinhaLoja { codigoLoja: number; estoque: number; vendida: number; minimo: number | null; sugestao: number; aChegar: number; cobertura: number | null; media: number; comprada: number }

/** Chave da série de uma distribuidora no gráfico (vira variável CSS, então sem símbolos). */
const serieDe = (i: number) => `s${i}`;
const idLoja = (l: { codigoLoja: number }) => String(l.codigoLoja);
const idDistribuidora = (l: { codigo: number }) => String(l.codigo);

function Indicador({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe: string }) {
  return (
    <Stack gap="tight">
      <Text variant="caption" tone="muted">{rotulo}</Text>
      <Text weight="semibold">{valor}</Text>
      <Text variant="caption" tone="muted">{detalhe}</Text>
    </Stack>
  );
}

/** Estudo de um produto: clicar numa Loja ou numa distribuidora filtra os gráficos, os indicadores e a outra tabela. Só leitura. */
export function EstudoProdutoWindow({ produto, lojas }: { produto: ProdutoDoEstudo; lojas: LojaOpcao[] }) {
  const { produtoId } = produto;
  const [estudo, setEstudo] = useState<Estudo | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  // Sem nada marcado, vale tudo; marcando Lojas ou distribuidoras, o estudo passa a mostrar só o recorte.
  const [lojasSel, setLojasSel] = useState<ReadonlySet<number>>(new Set());
  const [distsSel, setDistsSel] = useState<ReadonlySet<number>>(new Set());
  const nomeLoja = (codigo: number) => lojas.find((l) => l.codigo === codigo)?.nome ?? `Loja ${codigo}`;
  const alternar = (atual: ReadonlySet<number>, codigo: number): Set<number> => {
    const novo = new Set(atual);
    if (!novo.delete(codigo)) novo.add(codigo);
    return novo;
  };

  useEffect(() => {
    let atual = true;
    setEstudo(null);
    setFalha(null);
    apiFetch<Estudo>(`${API}/pedidos/lancamento/estudo?produtoId=${encodeURIComponent(produtoId)}`)
      .then((r) => atual && setEstudo(r))
      .catch((err: unknown) => atual && setFalha(err instanceof Error ? err.message : "Erro ao carregar o estudo."));
    return () => {
      atual = false;
    };
  }, [produtoId]);

  const meses = useMemo(() => (estudo ? ultimosMeses(estudo.hoje) : []), [estudo]);
  const recentes = useMemo(() => new Set(meses.slice(-3)), [meses]);
  const vendas = estudo?.vendas ?? null;
  const compras = estudo?.compras ?? null;
  const naLoja = useCallback((codigo: number) => lojasSel.size === 0 || lojasSel.has(codigo), [lojasSel]);
  const naDist = useCallback((codigo: number) => distsSel.size === 0 || distsSel.has(codigo), [distsSel]);

  // A Loja escolhida filtra as vendas e as compras; a distribuidora escolhida filtra as compras.
  const vendasSel = useMemo(() => (vendas ?? []).filter((v) => naLoja(v.codigoLoja)), [vendas, naLoja]);
  const comprasDaLoja = useMemo(() => (compras ?? []).filter((c) => naLoja(c.codigoLoja)), [compras, naLoja]);
  // A tabela de distribuidoras mostra todas as da Loja escolhida; os gráficos e os indicadores, só a escolhida.
  const comprasSel = useMemo(() => comprasDaLoja.filter((c) => naDist(c.codigoFornecedor)), [comprasDaLoja, naDist]);
  // A tabela de Lojas mostra todas as Lojas da distribuidora escolhida (compras) e sempre as vendas de cada uma.
  const comprasDaDist = useMemo(() => (compras ?? []).filter((c) => naDist(c.codigoFornecedor)), [compras, naDist]);

  const vendasPorMes = useMemo(() => meses.map((mes) => ({ mes: mesCurto(mes), venda: vendasSel.filter((v) => v.mes === mes).reduce((t, v) => t + v.vendida, 0) })), [meses, vendasSel]);

  const distribuidorasDaLoja = useMemo(() => porDistribuidora(comprasDaLoja), [comprasDaLoja]);
  const distribuidorasSel = useMemo(() => porDistribuidora(comprasSel), [comprasSel]);
  const linhasDist = useMemo<LinhaDistribuidora[]>(
    () =>
      distribuidorasDaLoja.map((d) => {
        const mensais = [...d.meses.entries()].filter(([, m]) => m.quantidade > 0).map(([mes, m]) => ({ mes, preco: m.valor / m.quantidade })).sort((a, b) => a.mes.localeCompare(b.mes));
        const precos = mensais.map((m) => m.preco);
        return { codigo: d.codigo, nome: d.nome, quantidade: d.quantidade, valor: d.valor, medio: d.quantidade ? d.valor / d.quantidade : 0, ultimo: mesBr(mensais.at(-1)?.mes ?? ""), ultimoCusto: mensais.at(-1)?.preco ?? 0, menor: Math.min(...precos), maior: Math.max(...precos) };
      }),
    [distribuidorasDaLoja],
  );
  const topo = distribuidorasSel.slice(0, MAX_SERIES);
  const seriesDist = topo.map((d, i) => ({ key: serieDe(i), label: d.nome }));
  const precoPorMes = useMemo(
    () =>
      meses.map((mes) => ({
        mes: mesCurto(mes),
        ...Object.fromEntries(topo.flatMap((d, i) => { const m = d.meses.get(mes); return m && m.quantidade > 0 ? [[serieDe(i), Number((m.valor / m.quantidade).toFixed(2))]] : []; })),
      })),
    [meses, topo],
  );

  const linhasLoja = useMemo<LinhaLoja[]>(() => {
    const vendasDe = (codigoLoja: number) => (vendas ?? []).filter((v) => v.codigoLoja === codigoLoja);
    return lojas.map(({ codigo: codigoLoja }) => {
      const l = produto.lojas.find((x) => x.codigoLoja === codigoLoja) ?? { codigoLoja, vendida: 0, estoque: 0, minimo: null, sugestao: 0, aChegar: 0 };
      const dela = vendasDe(codigoLoja);
      const diaria = vendas ? dela.filter((v) => recentes.has(v.mes)).reduce((t, v) => t + v.vendida, 0) / DIAS_DA_COBERTURA : null;
      const total = dela.reduce((t, v) => t + v.vendida, 0);
      return { ...l, media: total / MESES, cobertura: diaria && diaria > 0 ? l.estoque / diaria : null, comprada: comprasDaDist.filter((c) => c.codigoLoja === codigoLoja).reduce((t, c) => t + c.quantidade, 0) };
    });
  }, [lojas, produto, vendas, recentes, comprasDaDist]);
  const colunasLoja: DataTableColumn<LinhaLoja>[] = [
    { key: "marca", label: "", width: 40, centered: true, render: (l) => <Checkbox aria-label={`Selecionar ${nomeLoja(l.codigoLoja)}`} checked={lojasSel.has(l.codigoLoja)} onCheckedChange={() => setLojasSel(alternar(lojasSel, l.codigoLoja))} /> },
    { key: "loja", label: "Loja", value: (l) => nomeLoja(l.codigoLoja) },
    { key: "estoque", label: "Estoque", format: "decimal", value: (l) => l.estoque },
    { key: "media", label: "Venda média/mês", tooltip: "Média dos últimos 24 meses.", format: "decimal", value: (l) => l.media },
    { key: "vendida", label: "Vendida", tooltip: "Quantidade vendida no período filtrado do Lançamento.", format: "decimal", value: (l) => l.vendida },
    { key: "comprada", label: "Comprada", tooltip: "Entradas de NF dos últimos 24 meses (da distribuidora escolhida, se houver).", format: "decimal", value: (l) => l.comprada },
    { key: "minimo", label: "Mín.", tooltip: "Estoque mínimo", format: "decimal", value: (l) => l.minimo ?? 0 },
    { key: "sugestao", label: "Sug.", tooltip: "Sugestão", format: "decimal", value: (l) => l.sugestao },
    { key: "aChegar", label: "A chegar", format: "decimal", value: (l) => l.aChegar },
    { key: "cobertura", label: "Cobertura (dias)", tooltip: "Estoque dividido pela venda diária dos últimos 3 meses.", format: "decimal", value: (l) => (l.cobertura === null ? null : Math.round(l.cobertura)) },
  ];
  const colunasDist: DataTableColumn<LinhaDistribuidora>[] = [
    { key: "marca", label: "", width: 40, centered: true, render: (l) => <Checkbox aria-label={`Selecionar ${l.nome}`} checked={distsSel.has(l.codigo)} onCheckedChange={() => setDistsSel(alternar(distsSel, l.codigo))} /> },
    { key: "nome", label: "Distribuidora", value: (l) => l.nome },
    { key: "quantidade", label: "Qtde comprada", format: "decimal", value: (l) => l.quantidade },
    { key: "valor", label: "Valor", format: "currency", value: (l) => l.valor },
    { key: "ultimoCusto", label: "Último custo", tooltip: "Custo unitário médio do mês da última entrada.", format: "currency", value: (l) => l.ultimoCusto },
    { key: "menor", label: "Menor", format: "currency", value: (l) => l.menor },
    { key: "maior", label: "Maior", format: "currency", value: (l) => l.maior },
    { key: "medio", label: "Médio", tooltip: "Valor total das NFs dividido pela quantidade total.", format: "currency", value: (l) => l.medio },
    { key: "ultimo", label: "Última entrada", value: (l) => l.ultimo },
  ];

  // Indicadores do recorte escolhido (Loja e distribuidora).
  const estoque = linhasLoja.filter((l) => naLoja(l.codigoLoja)).reduce((t, l) => t + l.estoque, 0);
  const vendaMensal = vendas ? vendasSel.reduce((t, v) => t + v.vendida, 0) / MESES : null;
  const vendaDiaria = vendas ? vendasSel.filter((v) => recentes.has(v.mes)).reduce((t, v) => t + v.vendida, 0) / DIAS_DA_COBERTURA : null;
  const cobertura = vendaDiaria && vendaDiaria > 0 ? Math.round(estoque / vendaDiaria) : null;
  const ultima = [...distribuidorasSel].map((d) => ({ d, mes: [...d.meses.keys()].sort().at(-1) ?? "" })).sort((a, b) => b.mes.localeCompare(a.mes))[0];
  const custoDe = (d: Distribuidora) => (d.quantidade ? d.valor / d.quantidade : 0);
  const ultimoCusto = ultima ? (() => { const m = ultima.d.meses.get(ultima.mes); return m?.quantidade ? m.valor / m.quantidade : 0; })() : null;
  const maisBarata = distribuidorasSel.length > 1 ? distribuidorasSel.reduce((m, d) => (custoDe(d) < custoDe(m) ? d : m)) : undefined;
  const traco = "—";
  const nLojas = lojasSel.size || lojas.length;
  const recorte = [lojasSel.size ? plural(lojasSel.size, "Loja", "Lojas") : null, distsSel.size ? plural(distsSel.size, "distribuidora", "distribuidoras") : null].filter(Boolean).join(" · ");
  const limpar = lojasSel.size > 0 || distsSel.size > 0 ? <Button type="button" variant="outline" onClick={() => { setLojasSel(new Set()); setDistsSel(new Set()); }}>Limpar seleção</Button> : null;
  const semBloco = (titulo: string) => <Text tone="muted">{`Não foi possível carregar ${titulo} do ERP.`}</Text>;
  const carregando = !estudo && !falha;

  return (
    <>
      <Stack gap="section">
        <Stack direction="row" surface="muted" gap="section" wrap justify="between">
          <Indicador rotulo="Estoque" valor={formatNumber(estoque)} detalhe={plural(nLojas, "Loja", "Lojas")} />
          <Indicador rotulo="Venda média mensal" valor={vendaMensal === null ? traco : decimal(vendaMensal)} detalhe="24 meses" />
          <Indicador rotulo="Cobertura" valor={cobertura === null ? traco : `${formatNumber(cobertura)} dias`} detalhe="venda dos últimos 3 meses" />
          <Indicador rotulo="Último custo" valor={ultimoCusto ? dinheiro(ultimoCusto) : traco} detalhe={ultima ? ultima.d.nome + (maisBarata && maisBarata.codigo !== ultima.d.codigo ? ` (mais barata: ${maisBarata.nome})` : "") : "sem entradas de NF"} />
        </Stack>
        {falha ? <Text tone="muted">{falha}</Text> : carregando ? <Text tone="muted">Carregando o estudo…</Text> : (
          <>
            <Grid columns="split" gap="section">
              <Stack gap="field">
                <Text weight="semibold">{`Venda mensal${lojasSel.size ? `: ${plural(lojasSel.size, "Loja", "Lojas")}` : " da rede"}`}</Text>
                {vendas ? <SeriesChart data={vendasPorMes} xKey="mes" series={[{ key: "venda", label: lojasSel.size ? "Venda das Lojas" : "Venda da rede" }]} formatValue={decimal} /> : semBloco("as vendas")}
              </Stack>
              <Stack gap="field">
                <Text weight="semibold">{`Custo unitário${recorte ? `: ${recorte}` : " por distribuidora"}`}</Text>
                {compras ? (topo.length ? <SeriesChart kind="line" data={precoPorMes} xKey="mes" series={seriesDist} formatValue={dinheiro} /> : <Text tone="muted">Sem entradas de NF neste recorte nos últimos 24 meses.</Text>) : semBloco("as compras")}
              </Stack>
            </Grid>
            <Stack gap="field">
              <Stack direction="row" align="center" justify="between" gap="group">
                <Text weight="semibold">Lojas</Text>
                {limpar}
              </Stack>
              <DataTable embedded compact rowCursor={false} columns={colunasLoja} rows={linhasLoja} getRowId={idLoja} emptyMessage="Nenhuma Loja." />
            </Stack>
            <Stack gap="field">
              <Text weight="semibold">{lojasSel.size ? `Distribuidoras: ${plural(lojasSel.size, "Loja", "Lojas")}` : "Distribuidoras"}</Text>
              {compras ? <DataTable embedded compact rowCursor={false} columns={colunasDist} rows={linhasDist} getRowId={idDistribuidora} emptyMessage="Sem entradas de NF neste recorte nos últimos 24 meses." /> : semBloco("as compras")}
            </Stack>
          </>
        )}
      </Stack>
      <WindowActions>
        <WindowCancelButton>Fechar</WindowCancelButton>
      </WindowActions>
    </>
  );
}
