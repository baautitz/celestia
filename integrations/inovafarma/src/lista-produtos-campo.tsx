import { useEffect, useMemo, useState } from "react";
import { ListPlus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@platform/ui/components/combobox";
import { Label } from "@platform/ui/components/label";
import { Stack, Text } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { MIN_BUSCA_LISTA, TIPOS_ENTRADA, TIPO_ENTRADA_LABEL, ordenarEntradas, type EntradaLista, type TipoEntrada } from "./tipos-meta";

const BASE_LISTA = "/api/m/inovafarma/tipos-meta/lista";
const ESPERA_BUSCA_MS = 300;

const NENHUM: Record<TipoEntrada, string> = {
  produto: "Nenhum Produto encontrado.",
  grupo: "Nenhum Grupo encontrado.",
  secao: "Nenhuma Seção encontrada.",
  laboratorio: "Nenhum Laboratório encontrado.",
};

const PLURAL: Record<TipoEntrada, string> = { produto: "Produtos", grupo: "Grupos", secao: "Seções", laboratorio: "Laboratórios" };

interface Resultado {
  tipo: TipoEntrada;
  id: string;
  nome: string;
  detalhe: string | null;
}

const chave = (e: Pick<EntradaLista, "tipo" | "id">) => `${e.tipo}:${e.id.toUpperCase()}`;

/** A Lista em uma linha, na ordem dos tipos (ex.: "5 Produtos · 1 Grupo · 2 Laboratórios"), ou "Nenhuma entrada". */
export function resumirLista(entradas: readonly Pick<EntradaLista, "tipo">[]): string {
  const partes = TIPOS_ENTRADA.flatMap((t) => {
    const n = entradas.filter((e) => e.tipo === t).length;
    return n === 0 ? [] : [`${n} ${n === 1 ? TIPO_ENTRADA_LABEL[t] : PLURAL[t]}`];
  });
  return partes.length === 0 ? "Nenhuma entrada" : partes.join(" · ");
}

type Busca = { estado: "parado" } | { estado: "carregando" } | { estado: "pronto"; achados: Resultado[] } | { estado: "erro"; mensagem: string };

/**
 * Lista de Produtos no construtor do Tipo de Meta: o resumo em uma linha e o botão "Montar Lista", que abre a janela
 * larga com a busca e a tabela. Confere uma vez, ao abrir o construtor, quais entradas gravadas saíram do ERP.
 */
export function ListaProdutosCampo({ entradas, onChange, erro }: { entradas: EntradaLista[]; onChange: (entradas: EntradaLista[]) => void; erro?: string | null }) {
  const { windows } = useUi();
  const [ausentes, setAusentes] = useState<ReadonlySet<string>>(new Set());

  const [entradasIniciais] = useState(entradas);
  useEffect(() => {
    if (entradasIniciais.length === 0) return;
    let atual = true;
    apiFetch<{ ausentes: Pick<EntradaLista, "tipo" | "id">[] }>(`${BASE_LISTA}/conferir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entradas: entradasIniciais.map(({ tipo, id }) => ({ tipo, id })) }),
    })
      .then((r) => atual && setAusentes(new Set(r.ausentes.map(chave))))
      // Sem ERP, não dá para conferir: nenhuma entrada ganha o aviso.
      .catch(() => undefined);
    return () => {
      atual = false;
    };
  }, [entradasIniciais]);

  const foraDoErp = entradas.filter((e) => ausentes.has(chave(e))).length;

  const montar = async () => {
    const resultado = await windows.open<EntradaLista[]>({
      surface: "dialog",
      size: "full",
      title: "Lista de Produtos",
      description: "Os Produtos, Grupos, Seções e Laboratórios que a Meta soma. Cada produto vendido conta uma vez.",
      content: () => <ListaProdutosWindow inicial={entradas} ausentes={ausentes} />,
    });
    if (resultado.status === "confirmed") onChange(resultado.value);
  };

  return (
    <Stack gap="field">
      <Label>Lista de Produtos</Label>
      <Stack direction="row" gap="field" align="center" justify="between" wrap>
        <Stack direction="row" gap="field" align="center" wrap>
          <Text>{resumirLista(entradas)}</Text>
          {foraDoErp > 0 && (
            <Badge variant="warning">
              <TriangleAlert />
              {foraDoErp} não {foraDoErp === 1 ? "encontrado" : "encontrados"} no ERP
            </Badge>
          )}
        </Stack>
        <Button type="button" variant="outline" onClick={() => void montar()}>
          <ListPlus />
          Montar Lista
        </Button>
      </Stack>
      {erro && (
        <Text variant="small" tone="destructive" role="alert">
          {erro}
        </Text>
      )}
    </Stack>
  );
}

/**
 * Janela "Lista de Produtos": a busca no ERP em toda a largura, com o seletor de tipo à direita, e a tabela das entradas
 * por tipo e depois em ordem alfabética. Concluir devolve as entradas; Cancelar descarta (com confirmação se mudou).
 */
function ListaProdutosWindow({ inicial, ausentes }: { inicial: EntradaLista[]; ausentes: ReadonlySet<string> }) {
  const { resolve, setDirtyCheck } = useWindow<EntradaLista[]>();
  const [entradas, setEntradas] = useState(inicial);
  const [tipo, setTipo] = useState<TipoEntrada>("produto");
  const [termo, setTermo] = useState("");
  const [busca, setBusca] = useState<Busca>({ estado: "parado" });
  const [tentativa, setTentativa] = useState(0);
  const incluidas = useMemo(() => new Set(entradas.map(chave)), [entradas]);

  useEffect(() => {
    const iniciais = new Set(inicial.map(chave));
    const mudou = entradas.length !== inicial.length || entradas.some((e) => !iniciais.has(chave(e)));
    setDirtyCheck(() => mudou);
    return () => setDirtyCheck(null);
  }, [entradas, inicial, setDirtyCheck]);

  useEffect(() => {
    const q = termo.trim();
    if (q.length < MIN_BUSCA_LISTA[tipo]) {
      setBusca({ estado: "parado" });
      return;
    }
    let atual = true;
    setBusca({ estado: "carregando" });
    const espera = setTimeout(() => {
      apiFetch<Resultado[]>(`${BASE_LISTA}/busca?tipo=${tipo}&q=${encodeURIComponent(q)}`)
        .then((achados) => atual && setBusca({ estado: "pronto", achados }))
        .catch((err: unknown) => atual && setBusca({ estado: "erro", mensagem: err instanceof Error ? err.message : "Erro ao buscar no ERP." }));
    }, ESPERA_BUSCA_MS);
    return () => {
      atual = false;
      clearTimeout(espera);
    };
  }, [termo, tipo, tentativa]);

  const adicionar = (r: Resultado | null) => {
    if (!r || incluidas.has(chave(r))) return;
    setEntradas((atuais) => [...atuais, { tipo: r.tipo, id: r.id, nome: r.nome }]);
    setTermo("");
  };

  const nomeTipo = TIPO_ENTRADA_LABEL[tipo];
  const achados = busca.estado === "pronto" ? busca.achados : [];
  const vazio =
    termo.trim().length < MIN_BUSCA_LISTA[tipo]
      ? `Digite ao menos ${MIN_BUSCA_LISTA[tipo]} caracteres.`
      : busca.estado === "carregando"
        ? "Buscando no ERP…"
        : busca.estado === "erro"
          ? busca.mensagem
          : NENHUM[tipo];

  const colunas: DataTableColumn<EntradaLista>[] = [
    { key: "tipo", label: "Tipo", value: (e) => TIPO_ENTRADA_LABEL[e.tipo], render: (e) => <Badge variant="secondary">{TIPO_ENTRADA_LABEL[e.tipo]}</Badge>, nowrap: true },
    {
      key: "nome",
      label: "Nome",
      value: (e) => e.nome,
      mobileRole: "primary",
      render: (e) =>
        ausentes.has(chave(e)) ? (
          <Stack direction="row" gap="field" align="center" wrap>
            <Text>{e.nome}</Text>
            <Badge variant="warning">
              <TriangleAlert />
              não encontrado no ERP
            </Badge>
          </Stack>
        ) : (
          e.nome
        ),
    },
  ];

  return (
    <>
      <Stack gap="section">
        <Stack gap="field">
          <Label htmlFor="lista-produtos-busca">Adicionar à Lista</Label>
          <Stack direction="row" gap="field" align="center">
            <Stack grow>
              <Combobox
                autoHighlight
                filter={null}
                items={achados}
                value={null}
                inputValue={termo}
                onInputValueChange={setTermo}
                onValueChange={adicionar}
                itemToStringLabel={(r: Resultado) => r.nome}
                itemToStringValue={(r: Resultado) => chave(r)}
                isItemEqualToValue={(a: Resultado, b: Resultado) => chave(a) === chave(b)}
              >
                <ComboboxInput id="lista-produtos-busca" autoFocus showTrigger={false} placeholder={`Buscar ${nomeTipo} no ERP`} />
                <ComboboxContent>
                  <ComboboxEmpty>{vazio}</ComboboxEmpty>
                  <ComboboxList>
                    {(r: Resultado) => (
                      <ComboboxItem key={chave(r)} value={r} disabled={incluidas.has(chave(r))}>
                        {r.detalhe ? `${r.detalhe} · ${r.nome}` : r.nome}
                        {incluidas.has(chave(r)) ? " · já está na Lista" : ""}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </Stack>
            <Stack shrink={false}>
              <Select
                value={tipo}
                onValueChange={(t) => {
                  if (!t) return;
                  setTipo(t as TipoEntrada);
                }}
              >
                <SelectTrigger aria-label="Tipo da entrada">
                  <SelectValue>{(t: TipoEntrada) => TIPO_ENTRADA_LABEL[t]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_ENTRADA.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIPO_ENTRADA_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Stack>
          </Stack>
          {busca.estado === "erro" && (
            <Stack direction="row" gap="field" align="center" wrap>
              <Text variant="small" tone="destructive">
                {busca.mensagem}
              </Text>
              <Button type="button" variant="outline" onClick={() => setTentativa((n) => n + 1)}>
                <RotateCcw />
                Tentar de novo
              </Button>
            </Stack>
          )}
        </Stack>
        <DataTable
          columns={colunas}
          rows={ordenarEntradas(entradas)}
          getRowId={chave}
          title={(n) => `Lista (${n} ${n === 1 ? "entrada" : "entradas"})`}
          emptyMessage="Nenhuma entrada na Lista. Busque acima para adicionar."
          rowActions={(e) => (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              tone="destructive"
              aria-label={`Remover ${TIPO_ENTRADA_LABEL[e.tipo]} ${e.nome}`}
              onClick={() => setEntradas((atuais) => atuais.filter((x) => chave(x) !== chave(e)))}
            >
              <Trash2 />
            </Button>
          )}
        />
      </Stack>
      <WindowActions>
        <WindowCancelButton />
        <Button type="button" onClick={() => resolve(entradas)}>
          Concluir
        </Button>
      </WindowActions>
    </>
  );
}
