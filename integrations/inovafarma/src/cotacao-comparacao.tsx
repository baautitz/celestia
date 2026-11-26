import { useState } from "react";
import { Building2, Package } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@platform/ui/components/tabs";
import { usePreference } from "@platform/ui/hooks/use-preference";
import { Checkbox } from "@platform/ui/components/checkbox";
import { Input } from "@platform/ui/components/input";
import { Grid, Stack, Text } from "@platform/ui/components/layout";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import type { Escolhas, Parcela } from "./pedidos";

export interface ProdutoCotacao {
  produtoId: string;
  codigoProduto?: number | null;
  nome: string;
  quantidade: number;
  /** O que cada Loja leva da cotação. */
  lojas?: { codigoLoja: number; quantidade: number; /** Quantidades já definidas no Lançamento. */ definidas?: { codigoFornecedor: number; quantidade: number }[] }[];
  /** Código do fornecedor -> preço; null = sem oferta. */
  precos: Record<string, number | null>;
  /** Código do fornecedor -> quantidade que o Pedido pede a ele, e a que ele confirmou na planilha (null = não mexeu). */
  pedidas?: Record<string, number>;
  ofertadas?: Record<string, number | null>;
  /** Código do fornecedor -> última compra dele (preço e dia, AAAA-MM-DD); null = nunca comprou. */
  ultimas?: Record<string, { preco: number; dia: string } | null>;
}

/** Os fornecedores marcados no produto, cada um com a quantidade por Loja. Marcado com zero continua marcado. */
export type Marcados = Record<number, Record<number, number>>;

const numero = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dia = (iso: string) => iso.split("-").reverse().join("/");
const ofereceu = (p: ProdutoCotacao, codigo: number) => (p.precos[codigo] ?? null) !== null;
const somaDe = (porLoja: Record<number, number> | undefined) => Object.values(porLoja ?? {}).reduce((t, n) => t + n, 0);
const escolhidaDe = (marcados: Marcados) => Object.values(marcados).reduce((t, porLoja) => t + somaDe(porLoja), 0);

/** Reparte o total de uma distribuidora entre as Lojas, na ordem; o excedente fica na última. */
function repartir(lojas: NonNullable<ProdutoCotacao["lojas"]>, total: number): Record<number, number> {
  let resta = total;
  return Object.fromEntries(
    lojas.map((l, n) => {
      const q = n === lojas.length - 1 ? resta : Math.min(l.quantidade, resta);
      resta -= q;
      return [l.codigoLoja, q];
    }),
  );
}

export function marcadosDasParcelas(parcelas: Parcela[]): Marcados {
  const m: Marcados = {};
  for (const x of parcelas) m[x.codigoFornecedor] = { ...m[x.codigoFornecedor], [x.codigoLoja]: x.quantidade };
  return m;
}

/** A escolha gravada (confirmado) ou a padrão (menor preço) de um produto, como marcações. */
export function marcadosDa(p: ProdutoCotacao, escolha: Escolhas[string] | undefined): Marcados {
  if (escolha === undefined) return {};
  if (Array.isArray(escolha)) return marcadosDasParcelas(escolha);
  const lojas = p.lojas ?? [];
  const ofertada = p.ofertadas?.[escolha];
  return { [escolha]: ofertada === null || ofertada === undefined ? Object.fromEntries(lojas.map((l) => [l.codigoLoja, l.quantidade])) : repartir(lojas, ofertada) };
}

/** Marca (recebendo o que falta em cada Loja) ou desmarca um fornecedor. */
export function alternar(p: ProdutoCotacao, marcados: Marcados, codigo: number): Marcados {
  const { [codigo]: atual, ...outros } = marcados;
  if (atual) return outros;
  return { ...outros, [codigo]: Object.fromEntries((p.lojas ?? []).map((l) => [l.codigoLoja, Math.max(0, l.quantidade - Object.values(outros).reduce((t, porLoja) => t + (porLoja[l.codigoLoja] ?? 0), 0))])) };
}

export function parcelasDe(marcados: Marcados): Parcela[] {
  return Object.entries(marcados).flatMap(([codigo, porLoja]) => Object.entries(porLoja).filter(([, q]) => q > 0).map(([loja, quantidade]) => ({ codigoLoja: Number(loja), codigoFornecedor: Number(codigo), quantidade })));
}

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

type Visao = "produto" | "fornecedor";
const aceita = (v: unknown): v is Visao => v === "produto" || v === "fornecedor";

interface Props {
  produtos: ProdutoCotacao[];
  fornecedores: { codigo: number; nome: string }[];
  marcados: Record<string, Marcados>;
  editavel: boolean;
  confirmado: boolean;
  nomeLoja: (codigo: number) => string;
  onChange: (produtoId: string, marcados: Marcados) => void;
}

type Loja = NonNullable<ProdutoCotacao["lojas"]>[number];
interface Oferta {
  codigo: number;
  nome: string;
  preco: number;
}

/**
 * No desenho do Gerar pedido: produtos à esquerda, as Lojas do produto em foco à direita (as quantidades) e, embaixo,
 * os fornecedores dele (marcar).
 */
export function CotacaoComparacao({ produtos, fornecedores, marcados, editavel, confirmado, nomeLoja, onChange }: Props) {
  const [visao, salvarVisao] = usePreference<Visao>("inovafarma:cotacao:view", "produto", aceita);
  const [ativo, setAtivo] = useState<string | null>(null);
  const [fornAtivo, setFornAtivo] = useState<string | null>(null);
  const fornEmFoco = fornecedores.find((f) => String(f.codigo) === fornAtivo) ?? fornecedores[0];
  // Por fornecedor, a lista de baixo é o que ele cotou; o produto em foco sai dela.
  const doFornecedor = fornEmFoco ? produtos.filter((p) => ofereceu(p, fornEmFoco.codigo)) : [];
  const lista = visao === "produto" ? produtos : doFornecedor;
  const emFoco = lista.find((p) => p.produtoId === ativo) ?? lista[0];
  const marcadosDe = (p: ProdutoCotacao) => marcados[p.produtoId] ?? {};
  const m = emFoco ? marcadosDe(emFoco) : {};

  const ofertas: Oferta[] = emFoco ? fornecedores.flatMap((f) => (ofereceu(emFoco, f.codigo) ? [{ ...f, preco: emFoco.precos[f.codigo] as number }] : [])) : [];
  const menor = Math.min(...ofertas.map((o) => o.preco));
  const marcadas = ofertas.filter((o) => m[o.codigo] !== undefined);
  const totalDa = (codigoLoja: number) => marcadas.reduce((t, f) => t + (m[f.codigo]?.[codigoLoja] ?? 0), 0);

  const colunasProduto: DataTableColumn<ProdutoCotacao>[] = [
    { key: "codigo", label: "Código", value: (p) => p.codigoProduto ?? "", searchable: true, sortable: true, cellClassName: "font-mono text-xs" },
    { key: "nome", label: "Produto", value: (p) => p.nome, searchable: true, sortable: true, truncateAt: 40, mobileRole: "primary" },
    { key: "pedida", label: "Pedida", format: "decimal", value: (p) => p.quantidade },
    {
      key: "escolhida",
      label: "Escolhida",
      format: "decimal",
      value: (p) => escolhidaDe(marcadosDe(p)),
      render: (p) => {
        const total = escolhidaDe(marcadosDe(p));
        const difere = total !== p.quantidade;
        return <Text tone={difere ? "warning" : "default"} weight={difere ? "semibold" : undefined} title={difere ? "Diferente do pedido" : undefined}>{numero(total)}</Text>;
      },
    },
  ];

  const colunasLoja: DataTableColumn<Loja>[] = [
    { key: "loja", label: "Loja", value: (l) => nomeLoja(l.codigoLoja), mobileRole: "primary" },
    { key: "pedida", label: "Pedida", format: "decimal", value: (l) => l.quantidade },
    ...marcadas.map(
      (f): DataTableColumn<Loja> => ({
        key: `f${f.codigo}`,
        label: f.nome.split(" ")[0] ?? f.nome,
        tooltip: f.nome,
        // Numérica: cabeçalho e campo alinhados à direita.
        format: "decimal",
        value: (l) => m[f.codigo]?.[l.codigoLoja] ?? 0,
        cellClassName: "[&_input]:ml-auto [&_input]:w-20 [&_input]:text-right",
        render: (l) => {
          const q = m[f.codigo]?.[l.codigoLoja] ?? 0;
          if (!editavel || !emFoco) return <Text>{numero(q)}</Text>;
          return <CampoQtde key={`${emFoco.produtoId}|${q}`} valor={q} rotulo={`Quantidade de ${f.nome} para ${emFoco.nome} em ${nomeLoja(l.codigoLoja)}`} onChange={(n) => onChange(emFoco.produtoId, { ...m, [f.codigo]: { ...m[f.codigo], [l.codigoLoja]: n } })} />;
        },
      }),
    ),
    {
      key: "total",
      label: "Total",
      format: "decimal",
      value: (l) => totalDa(l.codigoLoja),
      render: (l) => <Text tone={totalDa(l.codigoLoja) === l.quantidade ? "default" : "warning"} weight={totalDa(l.codigoLoja) === l.quantidade ? undefined : "semibold"}>{numero(totalDa(l.codigoLoja))}</Text>,
    },
  ];

  const ultimaDe = (o: Oferta) => emFoco?.ultimas?.[o.codigo] ?? null;
  const variacaoDe = (o: Oferta) => {
    const ultima = ultimaDe(o);
    return ultima ? ((o.preco - ultima.preco) / ultima.preco) * 100 : null;
  };
  const colunasFornecedor: DataTableColumn<Oferta>[] = [
    ...(editavel || confirmado
      ? [
          {
            key: "marcado",
            label: "",
            width: 44,
            render: (o: Oferta) => <Checkbox checked={m[o.codigo] !== undefined} disabled={!editavel} aria-label={`Escolher ${o.nome} para ${emFoco?.nome}`} onCheckedChange={() => emFoco && onChange(emFoco.produtoId, alternar(emFoco, m, o.codigo))} />,
          } satisfies DataTableColumn<Oferta>,
        ]
      : []),
    { key: "nome", label: "Fornecedor", value: (o) => o.nome, mobileRole: "primary", cellClassName: "w-full" },
    {
      key: "preco",
      label: "Preço",
      format: "currency",
      value: (o) => o.preco,
      render: (o) => (
        <Text title={o.preco === menor ? "Menor preço" : undefined} weight={o.preco === menor ? "bold" : undefined} tone={o.preco === menor ? "success" : undefined}>
          {numero(o.preco)}
        </Text>
      ),
    },
    { key: "ultima", label: "Últ. compra", tooltip: "Preço da última compra deste fornecedor", format: "currency", value: (o) => ultimaDe(o)?.preco ?? null },
    {
      key: "dia",
      label: "Data",
      value: (o) => {
        const ultima = ultimaDe(o);
        return ultima ? dia(ultima.dia) : "-";
      },
    },
    {
      key: "variacao",
      label: "Variação",
      format: "decimal",
      value: variacaoDe,
      render: (o) => {
        const v = variacaoDe(o);
        if (v === null) return <Text tone="muted">-</Text>;
        return <Text tone={v > 0 ? "warning" : "success"}>{`${v > 0 ? "▲" : "▼"} ${Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</Text>;
      },
    },
  ];

  const valorDo = (codigo: number) => produtos.reduce((t, p) => t + somaDe(marcadosDe(p)[codigo]) * (p.precos[codigo] ?? 0), 0);
  const totais = fornecedores.flatMap((f) => (valorDo(f.codigo) > 0 ? [{ nome: f.nome, valor: valorDo(f.codigo) }] : []));
  const total = totais.reduce((t, x) => t + x.valor, 0);
  const sufixo = emFoco ? `: ${emFoco.nome}` : "";

  type Fornecedor = Props["fornecedores"][number];
  const colunasDosFornecedores: DataTableColumn<Fornecedor>[] = [
    { key: "nome", label: "Fornecedor", value: (f) => f.nome, searchable: true, sortable: true, truncateAt: 40, mobileRole: "primary" },
    { key: "produtos", label: "Produtos", format: "decimal", value: (f) => produtos.filter((p) => somaDe(marcadosDe(p)[f.codigo]) > 0).length },
    { key: "total", label: "Total", format: "currency", value: (f) => valorDo(f.codigo) },
  ];
  /** O que o fornecedor em foco cotou: a mesma marcação e comparação, com o produto na linha. */
  const precoDo = (p: ProdutoCotacao) => (fornEmFoco ? (p.precos[fornEmFoco.codigo] ?? 0) : 0);
  const ultimaDo = (p: ProdutoCotacao) => (fornEmFoco ? (p.ultimas?.[fornEmFoco.codigo] ?? null) : null);
  const variacaoDo = (p: ProdutoCotacao) => {
    const ultima = ultimaDo(p);
    return ultima ? ((precoDo(p) - ultima.preco) / ultima.preco) * 100 : null;
  };
  const colunasDosProdutos: DataTableColumn<ProdutoCotacao>[] = [
    ...(editavel || confirmado
      ? [
          {
            key: "marcado",
            label: "",
            width: 44,
            render: (p: ProdutoCotacao) => (fornEmFoco ? <Checkbox checked={marcadosDe(p)[fornEmFoco.codigo] !== undefined} disabled={!editavel} aria-label={`Escolher ${fornEmFoco.nome} para ${p.nome}`} onCheckedChange={() => onChange(p.produtoId, alternar(p, marcadosDe(p), fornEmFoco.codigo))} /> : null),
          } satisfies DataTableColumn<ProdutoCotacao>,
        ]
      : []),
    { key: "codigo", label: "Código", value: (p) => p.codigoProduto ?? "", searchable: true, sortable: true, cellClassName: "font-mono text-xs" },
    { key: "nome", label: "Produto", value: (p) => p.nome, searchable: true, sortable: true, mobileRole: "primary", cellClassName: "w-full" },
    { key: "pedida", label: "Pedida", format: "decimal", value: (p) => p.quantidade },
    { key: "escolhida", label: "Escolhida", format: "decimal", value: (p) => (fornEmFoco ? somaDe(marcadosDe(p)[fornEmFoco.codigo]) : 0) },
    {
      key: "preco",
      label: "Preço",
      format: "currency",
      value: precoDo,
      render: (p) => {
        const ehMenor = precoDo(p) === Math.min(...Object.values(p.precos).filter((x): x is number => x !== null));
        return <Text title={ehMenor ? "Menor preço" : undefined} weight={ehMenor ? "bold" : undefined} tone={ehMenor ? "success" : undefined}>{numero(precoDo(p))}</Text>;
      },
    },
    { key: "ultima", label: "Últ. compra", tooltip: "Preço da última compra deste fornecedor", format: "currency", value: (p) => ultimaDo(p)?.preco ?? null },
    {
      key: "variacao",
      label: "Variação",
      format: "decimal",
      value: variacaoDo,
      render: (p) => {
        const v = variacaoDo(p);
        if (v === null) return <Text tone="muted">-</Text>;
        return <Text tone={v > 0 ? "warning" : "success"}>{`${v > 0 ? "▲" : "▼"} ${Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</Text>;
      },
    },
  ];

  const tabelaLojas = (
    <Stack grow>
      <DataTable scroll="fill" title={`Lojas${sufixo}`} columns={colunasLoja} rows={emFoco?.lojas ?? []} getRowId={(l) => String(l.codigoLoja)} emptyMessage="Nenhuma Loja." />
    </Stack>
  );

  return (
    <>
      <Tabs value={visao} onValueChange={(v) => { if (aceita(v)) salvarVisao(v); }}>
        <TabsList aria-label="Agrupar cotação">
          <TabsTrigger value="produto" aria-label="Por produto"><Package />Por produto</TabsTrigger>
          <TabsTrigger value="fornecedor" aria-label="Por fornecedor"><Building2 />Por fornecedor</TabsTrigger>
        </TabsList>
      </Tabs>
      {visao === "produto" ? (
        <Grid key="produto" columns="workspace" gap="tight">
          <Stack grow>
            <DataTable scroll="fill" title="Produtos" columns={colunasProduto} rows={produtos} getRowId={(p) => p.produtoId} activeRowId={emFoco?.produtoId ?? null} onActiveRowChange={setAtivo} emptyMessage="Nenhum produto no Pedido." search={{ placeholder: "Buscar produto" }} />
          </Stack>
          {tabelaLojas}
          <Stack span="full" scroll="clip">
            <DataTable scroll="fill" title={`Fornecedores${sufixo}`} columns={colunasFornecedor} rows={ofertas} getRowId={(o) => String(o.codigo)} emptyMessage="Nenhum preço para este produto." />
          </Stack>
        </Grid>
      ) : (
        <Grid key="fornecedor" columns="workspace" gap="tight">
          <Stack grow>
            <DataTable scroll="fill" title="Fornecedores" columns={colunasDosFornecedores} rows={fornecedores} getRowId={(f) => String(f.codigo)} activeRowId={fornEmFoco ? String(fornEmFoco.codigo) : null} onActiveRowChange={setFornAtivo} emptyMessage="Nenhum fornecedor." search={{ placeholder: "Buscar fornecedor" }} />
          </Stack>
          {tabelaLojas}
          <Stack span="full" scroll="clip">
            <DataTable scroll="fill" title={fornEmFoco ? `Produtos: ${fornEmFoco.nome}` : "Produtos"} columns={colunasDosProdutos} rows={doFornecedor} getRowId={(p) => p.produtoId} activeRowId={emFoco?.produtoId ?? null} onActiveRowChange={setAtivo} emptyMessage="Nenhum preço deste fornecedor." search={{ placeholder: "Buscar produto" }} />
          </Stack>
        </Grid>
      )}
      {/* Resumo do pedido: um bloco por fornecedor e o total à direita, junto dos botões. */}
      <Stack direction="row" gap="group" justify="end" wrap shrink={false} surface="muted">
        {[...totais, { nome: "Total do pedido", valor: total }].map((x) => (
          <Stack key={x.nome} align="end">
            <Text variant="caption" tone="muted">
              {x.nome}
            </Text>
            <Text weight={x.nome === "Total do pedido" ? "bold" : "semibold"}>{`R$ ${numero(x.valor)}`}</Text>
          </Stack>
        ))}
      </Stack>
    </>
  );
}
