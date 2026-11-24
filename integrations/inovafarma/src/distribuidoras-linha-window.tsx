import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@platform/ui/components/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@platform/ui/components/combobox";
import { Label } from "@platform/ui/components/label";
import { Stack } from "@platform/ui/components/layout";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import { apiFetch } from "@platform/ui/lib/api";
import { API } from "./inovafarma-api";

export interface Distribuidora {
  codigo: number;
  nome: string;
}

interface Entrada {
  produtoId: string;
  codigoLoja: number;
  codigoFornecedor: number;
}

interface Props {
  produtoId: string;
  codigoLoja: number;
  /** O que a linha já tem; sem isso (nunca escolhido), a lista começa com as distribuidoras que já deram entrada no produto nesta Loja. */
  inicial: number[] | undefined;
  lista: Distribuidora[];
}

/**
 * Janela das distribuidoras de um produto numa Loja: a busca em cima e a tabela das escolhidas embaixo, como na Lista
 * de Produtos. Concluir devolve os códigos; Cancelar descarta.
 */
export function DistribuidorasLinhaWindow({ produtoId, codigoLoja, inicial, lista }: Props) {
  const { resolve } = useWindow<number[]>();
  const { feedback } = useUi();
  const [codigos, setCodigos] = useState<number[]>(inicial ?? []);

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

  const escolhidas = useMemo(() => codigos.map((c) => lista.find((d) => d.codigo === c) ?? { codigo: c, nome: `Distribuidora ${c}` }), [codigos, lista]);
  const livres = useMemo(() => lista.filter((d) => !codigos.includes(d.codigo)), [lista, codigos]);

  const colunas: DataTableColumn<Distribuidora>[] = [
    { key: "nome", label: "Distribuidora", value: (d) => d.nome, mobileRole: "primary" },
    {
      key: "remover",
      label: "",
      render: (d) => (
        <Button type="button" variant="ghost" size="icon" aria-label={`Remover ${d.nome}`} onClick={() => setCodigos((atual) => atual.filter((c) => c !== d.codigo))}>
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
          <Label htmlFor="distribuidoras-busca">Adicionar distribuidora</Label>
          <Combobox
            autoHighlight
            items={livres}
            value={null}
            onValueChange={(d: Distribuidora | null) => d && setCodigos((atual) => [...atual, d.codigo])}
            itemToStringLabel={(d: Distribuidora) => d.nome}
            itemToStringValue={(d: Distribuidora) => String(d.codigo)}
            isItemEqualToValue={(a: Distribuidora, b: Distribuidora) => a.codigo === b.codigo}
          >
            <ComboboxInput id="distribuidoras-busca" autoFocus showTrigger={false} placeholder="Buscar distribuidora" />
            <ComboboxContent>
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
        </Stack>
        <DataTable columns={colunas} rows={escolhidas} getRowId={(d) => String(d.codigo)} emptyMessage="Nenhuma distribuidora escolhida." />
      </Stack>
      <WindowActions>
        <WindowCancelButton>Cancelar</WindowCancelButton>
        <Button type="button" onClick={() => resolve(codigos)}>
          Concluir
        </Button>
      </WindowActions>
    </>
  );
}
