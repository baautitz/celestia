import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@platform/ui/components/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@platform/ui/components/combobox";
import { Label } from "@platform/ui/components/label";
import { Stack } from "@platform/ui/components/layout";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { WindowActions, WindowCancelButton, useWindow } from "@platform/ui/imperative/use-window";
import type { LojaOpcao } from "./loja-opcao";

const nomeDe = (l: LojaOpcao) => l.nome || `Loja ${l.codigo}`;

/** Janela para devolver Lojas à grade: a busca em cima e as escolhidas embaixo, como nas distribuidoras. Concluir devolve os códigos. */
export function LojasAdicionarWindow({ removidas }: { removidas: LojaOpcao[] }) {
  const { resolve } = useWindow<number[]>();
  const [codigos, setCodigos] = useState<number[]>([]);
  const escolhidas = useMemo(() => removidas.filter((l) => codigos.includes(l.codigo)), [removidas, codigos]);
  const livres = useMemo(() => removidas.filter((l) => !codigos.includes(l.codigo)), [removidas, codigos]);

  const colunas: DataTableColumn<LojaOpcao>[] = [
    { key: "nome", label: "Loja", value: (l) => nomeDe(l), mobileRole: "primary" },
    {
      key: "remover",
      label: "",
      width: 40,
      centered: true,
      render: (l) => (
        <Button type="button" variant="outline" size="icon" aria-label={`Tirar ${nomeDe(l)} da lista`} onClick={() => setCodigos((atual) => atual.filter((c) => c !== l.codigo))}>
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
          <Label htmlFor="lojas-busca">Adicionar Loja</Label>
          <Combobox
            autoHighlight
            items={livres}
            value={null}
            onValueChange={(l: LojaOpcao | null) => l && setCodigos((atual) => [...atual, l.codigo])}
            itemToStringLabel={nomeDe}
            itemToStringValue={(l: LojaOpcao) => String(l.codigo)}
            isItemEqualToValue={(a: LojaOpcao, b: LojaOpcao) => a.codigo === b.codigo}
          >
            <ComboboxInput id="lojas-busca" autoFocus showTrigger={false} placeholder="Buscar Loja" />
            <ComboboxContent>
              <ComboboxEmpty>Nenhuma Loja encontrada.</ComboboxEmpty>
              <ComboboxList>
                {(l: LojaOpcao) => (
                  <ComboboxItem key={l.codigo} value={l}>
                    {nomeDe(l)}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </Stack>
        <DataTable columns={colunas} rows={escolhidas} getRowId={(l) => String(l.codigo)} emptyMessage="Nenhuma Loja escolhida." />
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
