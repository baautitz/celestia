import { useEffect, useState } from "react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@platform/ui/components/combobox";
import { Label } from "@platform/ui/components/label";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { MIN_BUSCA_PRODUTO } from "./produtos-erp";

const ESPERA_BUSCA_MS = 300;

export interface ProdutoOpcao {
  id: string;
  nome: string;
  codigoBarra: string | null;
}

const rotulo = (p: ProdutoOpcao) => (p.codigoBarra ? `${p.nome} (${p.codigoBarra})` : p.nome);

interface Props {
  /** Rota da busca no servidor; recebe `?q=`. */
  url: string;
  id: string;
  onChange: (produto: ProdutoOpcao | null) => void;
}

/**
 * Campo de busca de Pré-vencido por código de barras ou nome: os resultados aparecem enquanto digita (ou bipa)
 * e, com um só resultado, o produto já fica escolhido. Fala só no identificador opaco do produto.
 */
export function ProdutoBusca({ url, id, onChange }: Props) {
  const { feedback } = useUi();
  const [busca, setBusca] = useState("");
  const [produtos, setProdutos] = useState<ProdutoOpcao[]>([]);
  const [escolhido, setEscolhido] = useState<ProdutoOpcao | null>(null);

  const escolher = (produto: ProdutoOpcao | null) => {
    setEscolhido(produto);
    onChange(produto);
  };

  useEffect(() => {
    const termo = busca.trim();
    if (escolhido && busca === rotulo(escolhido)) return;
    if (termo.length < MIN_BUSCA_PRODUTO) {
      setProdutos([]);
      return;
    }
    let atual = true;
    const espera = setTimeout(() => {
      apiFetch<ProdutoOpcao[]>(`${url}?q=${encodeURIComponent(termo)}`)
        .then((achados) => {
          if (!atual) return;
          setProdutos(achados);
          if (achados.length === 1) {
            escolher(achados[0]!);
            setBusca(rotulo(achados[0]!));
          } else if (escolhido) escolher(null);
        })
        .catch((err: unknown) => {
          if (atual) feedback.notifyError(err instanceof Error ? err : new Error("Erro ao buscar o produto."));
        });
    }, ESPERA_BUSCA_MS);
    return () => {
      atual = false;
      clearTimeout(espera);
    };
    // `escolher` e `feedback` não mudam o resultado da busca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  return (
    <>
      <Label htmlFor={id}>Produto (bipe o código de barras ou digite o nome)</Label>
      <Combobox
        autoHighlight
        filter={null}
        items={produtos}
        value={escolhido}
        inputValue={busca}
        onInputValueChange={setBusca}
        onValueChange={(p: ProdutoOpcao | null) => {
          escolher(p);
          if (p) setBusca(rotulo(p));
        }}
        itemToStringLabel={rotulo}
        itemToStringValue={(p: ProdutoOpcao) => p.id}
        isItemEqualToValue={(a: ProdutoOpcao, b: ProdutoOpcao) => a.id === b.id}
      >
        <ComboboxInput id={id} autoFocus showTrigger={false} placeholder="Código de barras ou nome" />
        <ComboboxContent>
          <ComboboxEmpty>{busca.trim().length < MIN_BUSCA_PRODUTO ? `Digite ao menos ${MIN_BUSCA_PRODUTO} caracteres.` : "Nenhum produto encontrado."}</ComboboxEmpty>
          <ComboboxList>
            {(p: ProdutoOpcao) => (
              <ComboboxItem key={p.id} value={p}>
                {rotulo(p)}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </>
  );
}
