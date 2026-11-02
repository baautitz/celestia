import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@platform/ui/components/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@platform/ui/components/combobox";
import { Input } from "@platform/ui/components/input";
import { Label } from "@platform/ui/components/label";
import { Stack, Text } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import type { ListaProdutos, Meta } from "./metas-store";

const MIN_BUSCA = 3;
const ESPERA_BUSCA_MS = 300;

interface ProdutoOpcao {
  produtoId: string;
  nome: string;
  codigoBarra: string | null;
}

const inteiro = (texto: string): number | null => {
  const n = Number(texto);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Janela da Lista de Produtos de uma Meta: cada produto com a quantidade igual para todos, os ajustes por Colaborador
 * e o mínimo de produtos batidos (em branco: todos). Resolve com a Meta gravada.
 */
export function ListaProdutosWindow({ meta, somenteLeitura }: { meta: Meta; somenteLeitura: boolean }) {
  const { resolve } = useWindow<Meta>();
  const { feedback } = useUi();
  const inicial: ListaProdutos = meta.lista ?? { produtos: [], minimo: null, ajustes: [] };
  const [produtos, setProdutos] = useState(inicial.produtos);
  const [ajustes, setAjustes] = useState(inicial.ajustes);
  const [minimo, setMinimo] = useState(inicial.minimo === null ? "" : String(inicial.minimo));
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<ProdutoOpcao[]>([]);
  const [ajuste, setAjuste] = useState({ codigoColaborador: "", produtoId: "", quantidade: "" });
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < MIN_BUSCA) {
      setAchados([]);
      return;
    }
    let atual = true;
    const espera = setTimeout(() => {
      apiFetch<ProdutoOpcao[]>(`/api/m/inovafarma/metas/produtos?q=${encodeURIComponent(termo)}`)
        .then((lista) => atual && setAchados(lista))
        .catch((err: unknown) => atual && feedback.notifyError(err instanceof Error ? err : new Error("Erro ao buscar o produto.")));
    }, ESPERA_BUSCA_MS);
    return () => {
      atual = false;
      clearTimeout(espera);
    };
  }, [busca, feedback]);

  const adicionar = (p: ProdutoOpcao | null) => {
    if (!p) return;
    if (!produtos.some((x) => x.produtoId === p.produtoId)) setProdutos([...produtos, { produtoId: p.produtoId, nome: p.nome, quantidade: 1 }]);
    setBusca("");
  };
  const remover = (produtoId: string) => {
    setProdutos(produtos.filter((p) => p.produtoId !== produtoId));
    setAjustes(ajustes.filter((a) => a.produtoId !== produtoId));
  };
  const nomeProduto = (id: string) => produtos.find((p) => p.produtoId === id)?.nome ?? "";
  const nomeColaborador = (codigo: number) => meta.participantes.find((p) => p.codigoColaborador === codigo)?.nome ?? `cód. ${codigo}`;

  const incluirAjuste = () => {
    const codigoColaborador = Number(ajuste.codigoColaborador);
    const quantidade = inteiro(ajuste.quantidade);
    if (!codigoColaborador || !ajuste.produtoId || quantidade === null) {
      feedback.notifyError(new Error("Escolha o Colaborador, o produto e a quantidade."));
      return;
    }
    setAjustes([...ajustes.filter((a) => !(a.codigoColaborador === codigoColaborador && a.produtoId === ajuste.produtoId)), { codigoColaborador, produtoId: ajuste.produtoId, quantidade }]);
    setAjuste({ codigoColaborador: "", produtoId: "", quantidade: "" });
  };

  const salvar = async () => {
    if (produtos.some((p) => p.quantidade < 1)) {
      feedback.notifyError(new Error("Informe a quantidade de cada produto."));
      return;
    }
    setEnviando(true);
    try {
      const gravada = await apiFetch<Meta>(`/api/m/inovafarma/metas/${meta.id}/lista`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: meta.version, produtos, minimo: minimo.trim() ? inteiro(minimo) : null, ajustes }),
      });
      feedback.notify({ type: "success", title: "Lista de Produtos salva." });
      resolve(gravada);
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao salvar a Lista de Produtos."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <Stack gap="section">
        {!somenteLeitura && (
          <Stack gap="field">
            <Label htmlFor="lista-produtos-busca">Adicionar produto (código de barras ou nome)</Label>
            <Combobox
              autoHighlight
              filter={null}
              items={achados}
              value={null}
              inputValue={busca}
              onInputValueChange={setBusca}
              onValueChange={adicionar}
              itemToStringLabel={(p: ProdutoOpcao) => p.nome}
              itemToStringValue={(p: ProdutoOpcao) => p.produtoId}
              isItemEqualToValue={(a: ProdutoOpcao, b: ProdutoOpcao) => a.produtoId === b.produtoId}
            >
              <ComboboxInput id="lista-produtos-busca" showTrigger={false} placeholder="Código de barras ou nome" />
              <ComboboxContent>
                <ComboboxEmpty>{busca.trim().length < MIN_BUSCA ? `Digite ao menos ${MIN_BUSCA} caracteres.` : "Nenhum produto encontrado."}</ComboboxEmpty>
                <ComboboxList>
                  {(p: ProdutoOpcao) => (
                    <ComboboxItem key={p.produtoId} value={p}>
                      {p.codigoBarra ? `${p.codigoBarra} · ${p.nome}` : p.nome}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </Stack>
        )}

        <Stack gap="field">
          <Label>Produtos e quantidade para todos</Label>
          {produtos.length === 0 && (
            <Text variant="small" tone="muted">
              Nenhum produto na Lista.
            </Text>
          )}
          {produtos.map((p) => (
            <Stack key={p.produtoId} direction="row" gap="field" align="center">
              <Text variant="small">{p.nome}</Text>
              <Input
                inputMode="numeric"
                disabled={somenteLeitura}
                aria-label={`Quantidade de ${p.nome}`}
                value={p.quantidade ? String(p.quantidade) : ""}
                onChange={(e) => setProdutos(produtos.map((x) => (x === p ? { ...x, quantidade: inteiro(e.target.value) ?? 0 } : x)))}
              />
              {!somenteLeitura && (
                <Button size="icon" variant="ghost" aria-label={`Remover ${p.nome}`} onClick={() => remover(p.produtoId)}>
                  <Trash2 />
                </Button>
              )}
            </Stack>
          ))}
        </Stack>

        <Stack gap="field">
          <Label htmlFor="lista-produtos-minimo">Mínimo de produtos batidos (em branco: todos)</Label>
          <Input id="lista-produtos-minimo" inputMode="numeric" disabled={somenteLeitura} value={minimo} onChange={(e) => setMinimo(e.target.value)} />
        </Stack>

        <Stack gap="field">
          <Label>Ajustes por Colaborador</Label>
          {ajustes.map((a) => (
            <Stack key={`${a.codigoColaborador}-${a.produtoId}`} direction="row" gap="field" align="center">
              <Text variant="small">
                {nomeColaborador(a.codigoColaborador)} · {nomeProduto(a.produtoId)}: {a.quantidade}
              </Text>
              {!somenteLeitura && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remover ajuste de ${nomeColaborador(a.codigoColaborador)}`}
                  onClick={() => setAjustes(ajustes.filter((x) => x !== a))}
                >
                  <Trash2 />
                </Button>
              )}
            </Stack>
          ))}
          {!somenteLeitura && produtos.length > 0 && (
            <Stack direction="row" gap="field" align="end" wrap>
              <Select value={ajuste.codigoColaborador} onValueChange={(v) => v && setAjuste({ ...ajuste, codigoColaborador: v })}>
                <SelectTrigger aria-label="Colaborador do ajuste">
                  <SelectValue>{(v: string) => (v ? nomeColaborador(Number(v)) : "Colaborador")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {meta.participantes.map((p) => (
                    <SelectItem key={p.codigoColaborador} value={String(p.codigoColaborador)}>
                      {p.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={ajuste.produtoId} onValueChange={(v) => v && setAjuste({ ...ajuste, produtoId: v })}>
                <SelectTrigger aria-label="Produto do ajuste">
                  <SelectValue>{(v: string) => (v ? nomeProduto(v) : "Produto")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {produtos.map((p) => (
                    <SelectItem key={p.produtoId} value={p.produtoId}>
                      {p.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input inputMode="numeric" aria-label="Quantidade do ajuste" value={ajuste.quantidade} onChange={(e) => setAjuste({ ...ajuste, quantidade: e.target.value })} />
              <Button type="button" variant="outline" onClick={incluirAjuste}>
                <Plus />
                Ajustar
              </Button>
            </Stack>
          )}
        </Stack>
      </Stack>
      <WindowActions>
        <WindowCancelButton>{somenteLeitura ? "Fechar" : "Cancelar"}</WindowCancelButton>
        {!somenteLeitura && (
          <Button type="button" disabled={enviando} onClick={() => void salvar()}>
            Salvar
          </Button>
        )}
      </WindowActions>
    </>
  );
}
