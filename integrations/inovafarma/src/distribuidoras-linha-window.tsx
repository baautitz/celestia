import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@platform/ui/components/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@platform/ui/components/combobox";
import { Input } from "@platform/ui/components/input";
import { Label } from "@platform/ui/components/label";
import { Grid, Stack, Text } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { API } from "./inovafarma-api";
import type { LojaOpcao } from "./loja-opcao";

export interface Distribuidora {
  codigo: number;
  nome: string;
}

/** De onde vem uma linha (produto, Loja): as distribuidoras a cotar e quanto cada outra Loja manda. */
export interface Fornecimento {
  codigos: number[];
  lojas: { codigoLoja: number; quantidade: number }[];
  /** Quanto se quer de cada distribuidora; a que não está aqui cota o restante. */
  quantidades?: { codigoFornecedor: number; quantidade: number }[];
}

interface Entrada {
  produtoId: string;
  codigoLoja: number;
  codigoFornecedor: number;
}

interface Props {
  produtoId: string;
  codigoLoja: number;
  /** O que a linha pede. */
  quantidade: number;
  /** O que a linha já tem; sem isso (nunca escolhido), a lista começa com as distribuidoras que já deram entrada no produto nesta Loja. */
  inicial: Fornecimento | undefined;
  lista: Distribuidora[];
  /** As Lojas; a da própria linha não pode fornecer para si. */
  lojas: LojaOpcao[];
}

type Tipo = "distribuidora" | "loja";
const TIPOS: Record<Tipo, string> = { distribuidora: "Distribuidora", loja: "Loja" };

interface Escolhido {
  tipo: Tipo;
  codigo: number;
  nome: string;
  quantidade?: number;
}

/**
 * Janela dos fornecedores de um produto numa Loja: o tipo e a busca em cima e a tabela dos escolhidos embaixo, como na
 * Lista de Produtos. A linha pode levar várias Lojas, cada uma com a sua quantidade, e várias distribuidoras; a
 * quantidade da distribuidora é opcional e, vazia, ela cota o restante. Concluir devolve o fornecimento; Cancelar descarta.
 */
export function DistribuidorasLinhaWindow({ produtoId, codigoLoja, quantidade, inicial, lista, lojas }: Props) {
  const { resolve } = useWindow<Fornecimento & { quantidade: number }>();
  const { feedback } = useUi();
  const [codigos, setCodigos] = useState<number[]>(inicial?.codigos ?? []);
  const [deLojas, setDeLojas] = useState<Fornecimento["lojas"]>(inicial?.lojas ?? []);
  const [tipo, setTipo] = useState<Tipo>("distribuidora");
  // Estoque do produto em cada Loja, para comparar quanto cada uma pode mandar; null enquanto não carrega.
  const [estoques, setEstoques] = useState<{ codigoLoja: number; estoque: number }[] | null>(null);
  useEffect(() => {
    let atual = true;
    apiFetch<{ codigoLoja: number; estoque: number }[]>(`${API}/pedidos/lancamento/estoques?produtoId=${encodeURIComponent(produtoId)}`)
      .then((r) => atual && setEstoques(r))
      .catch((err: unknown) => atual && feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar o estoque.")));
    return () => {
      atual = false;
    };
  }, [produtoId, feedback]);
  const [definidas, setDefinidas] = useState<Record<number, number>>(() => Object.fromEntries((inicial?.quantidades ?? []).map((d) => [d.codigoFornecedor, d.quantidade])));

  useEffect(() => {
    if (inicial) return;
    let atual = true;
    apiFetch<Entrada[]>(`${API}/pedidos/lancamento/entradas?produtoIds=${encodeURIComponent(produtoId)}`)
      .then((entradas) => {
        if (!atual) return;
        const dessaLoja = entradas.filter((e) => e.codigoLoja === codigoLoja).map((e) => e.codigoFornecedor);
        setCodigos((agora) => [...new Set([...agora, ...dessaLoja])]);
      })
      .catch((err: unknown) => atual && feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar as entradas de NF.")));
    return () => {
      atual = false;
    };
  }, [inicial, produtoId, codigoLoja, feedback]);

  const daLoja = useMemo<Distribuidora[]>(() => lojas.filter((l) => l.codigo !== codigoLoja), [lojas, codigoLoja]);
  const escolhidos: Escolhido[] = [
    ...deLojas.map((l) => ({ tipo: "loja" as const, codigo: l.codigoLoja, nome: daLoja.find((x) => x.codigo === l.codigoLoja)?.nome ?? `Loja ${l.codigoLoja}`, quantidade: l.quantidade })),
    ...codigos.map((c) => ({ tipo: "distribuidora" as const, codigo: c, nome: lista.find((d) => d.codigo === c)?.nome ?? `Distribuidora ${c}` })),
  ];
  const livres = tipo === "loja" ? daLoja.filter((l) => !deLojas.some((x) => x.codigoLoja === l.codigo)) : lista.filter((d) => !codigos.includes(d.codigo));
  const alvo = tipo === "loja" ? "Loja" : "distribuidora";
  const dasLojas = deLojas.reduce((t, l) => t + l.quantidade, 0);
  // O Pedir acompanha as Lojas: nunca fica abaixo da soma delas. `digitando` segura o texto enquanto o campo é editado.
  const [pedir, setPedir] = useState(quantidade);
  const [digitando, setDigitando] = useState<string | null>(null);
  const quantidades = codigos.flatMap((c) => ((definidas[c] ?? 0) > 0 ? [{ codigoFornecedor: c, quantidade: definidas[c] as number }] : []));
  const dasDistribuidoras = quantidades.reduce((t, d) => t + d.quantidade, 0);
  const total = Math.max(pedir, dasLojas + dasDistribuidoras);
  const paraCotar = total - dasLojas;
  const restante = paraCotar - dasDistribuidoras;
  const abertas = codigos.length - quantidades.length;
  const aviso = restante > 0 && abertas === 0 && escolhidos.length > 0 ? `Selecione um fornecedor para ${restante === 1 ? "a unidade restante" : `as ${restante} unidades restantes`}.` : "";

  const adicionar = (codigo: number) => {
    if (tipo === "loja") setDeLojas((atual) => [...atual, { codigoLoja: codigo, quantidade: 0 }]);
    else setCodigos((atual) => [...atual, codigo]);
  };
  const remover = (e: Escolhido) => {
    if (e.tipo === "loja") setDeLojas((atual) => atual.filter((l) => l.codigoLoja !== e.codigo));
    else setCodigos((atual) => atual.filter((c) => c !== e.codigo));
  };

  const colunas: DataTableColumn<Escolhido>[] = [
    { key: "tipo", label: "Tipo", value: (e) => TIPOS[e.tipo] },
    { key: "nome", label: "Nome", value: (e) => e.nome, truncateAt: 36, mobileRole: "primary" },
    {
      key: "estoque",
      label: "Estoque",
      format: "decimal",
      value: (e) => (e.tipo === "loja" ? (estoques ? (estoques.find((x) => x.codigoLoja === e.codigo)?.estoque ?? 0) : null) : null),
    },
    {
      key: "quantidade",
      label: "Qtd.",
      width: 96,
      render: (e) =>
        e.tipo === "loja" ? (
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            placeholder="0"
            aria-label={`Quantidade de ${e.nome}`}
            defaultValue={e.quantidade || ""}
            onChange={(ev) => {
              const n = Math.max(0, Math.trunc(Number(ev.target.value) || 0));
              setDeLojas((atual) => atual.map((l) => (l.codigoLoja === e.codigo ? { ...l, quantidade: n } : l)));
            }}
          />
        ) : (
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            placeholder={String(Math.max(0, restante))}
            aria-label={`Quantidade de ${e.nome}`}
            defaultValue={definidas[e.codigo] || ""}
            onChange={(ev) => {
              const n = Math.max(0, Math.trunc(Number(ev.target.value) || 0));
              setDefinidas((atual) => ({ ...atual, [e.codigo]: n }));
            }}
          />
        ),
    },
    {
      key: "remover",
      label: "",
      render: (e) => (
        <Button type="button" variant="outline" size="icon" aria-label={`Remover ${e.nome}`} onClick={() => remover(e)}>
          <Trash2 />
        </Button>
      ),
      mobileRole: "hidden",
    },
  ];

  return (
    <>
      <Stack gap="section">
        <Stack gap="field">
          <Label htmlFor="fornecedor-pedir">Pedir nesta Loja</Label>
          <Input
            id="fornecedor-pedir"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={digitando ?? String(total)}
            onChange={(e) => {
              setDigitando(e.target.value);
              setPedir(Math.max(0, Math.trunc(Number(e.target.value) || 0)));
            }}
            onBlur={() => setDigitando(null)}
          />
        </Stack>
        <Grid columns="split" gap="group">
          <Stack gap="field">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v) => v && setTipo(v as Tipo)}>
              <SelectTrigger aria-label="Tipo de fornecedor">
                <SelectValue>{(v: Tipo) => TIPOS[v]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="distribuidora">Distribuidora</SelectItem>
                <SelectItem value="loja">Loja</SelectItem>
              </SelectContent>
            </Select>
          </Stack>
          <Stack gap="field">
            <Label htmlFor="distribuidoras-busca">Adicionar {alvo}</Label>
            <Combobox
              autoHighlight
              items={livres}
              value={null}
              onValueChange={(d: Distribuidora | null) => d && adicionar(d.codigo)}
              itemToStringLabel={(d: Distribuidora) => d.nome}
              itemToStringValue={(d: Distribuidora) => String(d.codigo)}
              isItemEqualToValue={(a: Distribuidora, b: Distribuidora) => a.codigo === b.codigo}
            >
              <ComboboxInput id="distribuidoras-busca" autoFocus showTrigger={false} placeholder={`Buscar ${alvo}`} />
              <ComboboxContent>
                <ComboboxEmpty>Nenhuma {alvo} encontrada.</ComboboxEmpty>
                <ComboboxList>
                  {(d: Distribuidora) => (
                    <ComboboxItem key={d.codigo} value={d}>
                      {d.nome}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </Stack>
        </Grid>
        <DataTable columns={colunas} rows={escolhidos} getRowId={(e) => `${e.tipo}:${e.codigo}`} emptyMessage="Nenhum fornecedor escolhido." />
        <Stack gap="field">
          <Text tone="muted">{`Total: ${total} · De outras Lojas: ${dasLojas} · A cotar: ${paraCotar}`}</Text>
          {aviso ? <Text tone="warning">{aviso}</Text> : null}
        </Stack>
      </Stack>
      <WindowActions>
        <WindowCancelButton>Cancelar</WindowCancelButton>
        <Button type="button" onClick={() => resolve({ codigos, lojas: deLojas.filter((l) => l.quantidade > 0), quantidades, quantidade: total })}>
          Concluir
        </Button>
      </WindowActions>
    </>
  );
}
