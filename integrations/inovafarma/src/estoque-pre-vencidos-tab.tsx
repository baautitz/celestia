import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@platform/ui/components/button";
import { Label } from "@platform/ui/components/label";
import { Show, Stack } from "@platform/ui/components/layout";
import { Switch } from "@platform/ui/components/switch";
import { HeaderActions } from "@platform/ui/context/header-actions";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { formatDate } from "@platform/ui/lib/format";
import { dataBr } from "./datas";
import { ItemPreVencidoWindow, type InclusaoRetroativa, type ItemPreVencido, type ItemSalvo } from "./item-pre-vencido-window";
import type { LojaOpcao } from "./loja-opcao";
import { LojaSelect, SemLojas } from "./loja-select";
import { API } from "./inovafarma-api";
import { useLatestFetch } from "./use-latest-fetch";

const BASE = `${API}/pre-vencidos`;

/**
 * Aba Estoque: os Itens de Pré-vencido de uma Loja do Vínculo, com inclusão, edição e exclusão em janela.
 * `retroativa`, só para quem gere as Baixas: os limites da data de abrangência retroativa que o servidor calculou.
 */
export function EstoquePreVencidosTab({ lojas, retroativa }: { lojas: LojaOpcao[]; retroativa?: InclusaoRetroativa }) {
  const { feedback, windows } = useUi();
  const [loja, setLoja] = useState(String(lojas[0]?.codigo ?? ""));
  const [zerados, setZerados] = useState(false);
  const [itens, setItens] = useState<ItemPreVencido[]>([]);
  const [carregando, setCarregando] = useState(false);

  // Só a resposta da última consulta vale: uma resposta atrasada não apaga o que uma consulta mais nova trouxe.
  const novaConsulta = useLatestFetch();
  const carregar = useCallback(async () => {
    if (!loja) return;
    const vale = novaConsulta();
    setCarregando(true);
    try {
      const recebidos = await apiFetch<ItemPreVencido[]>(`${BASE}/estoque/itens?codigoLoja=${encodeURIComponent(loja)}${zerados ? "&zerados=true" : ""}`);
      if (vale()) setItens(recebidos);
    } catch (err: unknown) {
      if (vale()) feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar o Estoque de Pré-vencidos."));
    } finally {
      if (vale()) setCarregando(false);
    }
  }, [loja, zerados, feedback, novaConsulta]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (lojas.length === 0) return <SemLojas />;

  const abrir = async (item?: ItemPreVencido) => {
    // O Item salvo já aparece na tabela; a recarga confirma com o servidor.
    const mostrar = (salvo: ItemSalvo) => {
      if (String(salvo.codigoLoja) === loja) {
        // A edição volta sem o Restante, que depende das vendas: fica o anterior até a recarga.
        setItens((atuais) =>
          atuais.some((i) => i.id === salvo.id) ? atuais.map((i) => (i.id === salvo.id ? { ...i, ...salvo } : i)) : [...atuais, { ...salvo, restante: salvo.restante ?? salvo.quantidade }],
        );
      }
    };
    const resultado = await windows.open<ItemSalvo>({
      surface: "dialog",
      size: "small",
      title: item ? "Editar Item" : "Incluir Item",
      description: item ? item.nomeProduto : "Inclua um Pré-vencido que está na prateleira da Loja.",
      content: () => <ItemPreVencidoWindow codigoLoja={Number(loja)} item={item} retroativa={retroativa} onSalvo={mostrar} />,
    });
    if (resultado.status === "confirmed") mostrar(resultado.value);
    // Com "Adicionar mais" a janela pode fechar sem confirmar depois de salvar Itens: a recarga cobre os dois casos.
    void carregar();
  };

  const excluir = async (item: ItemPreVencido) => {
    const ok = await windows.confirm({
      title: "Excluir Item",
      description: `Excluir o Item de ${item.quantidade} un. de "${item.nomeProduto}" (validade ${dataBr(item.validade)})?`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`${BASE}/estoque/itens/${item.id}?version=${item.version}`, { method: "DELETE" });
      feedback.notify({ type: "success", title: "Item excluído." });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao excluir o Item."));
    }
    void carregar();
  };

  const colunas: DataTableColumn<ItemPreVencido>[] = [
    { key: "produto", label: "Produto", value: (i) => i.nomeProduto, searchable: true, sortable: true },
    { key: "codigoBarra", label: "Código de barras", value: (i) => i.codigoBarra ?? "", searchable: true },
    { key: "validade", centered: true, label: "Validade", value: (i) => i.validade, render: (i) => dataBr(i.validade), sortable: true },
    { key: "quantidade", label: "Quantidade", value: (i) => i.quantidade, format: "number", sortable: true },
    { key: "restante", label: "Restante", value: (i) => i.restante, format: "number", sortable: true },
    { key: "abrangenciaEm", centered: true, label: "Data de abrangência", value: (i) => i.abrangenciaEm, render: (i) => formatDate(i.abrangenciaEm), sortable: true },
  ];

  return (
    <Stack gap="section">
      <HeaderActions>
        <Show on="lgUp">
          <Button onClick={() => void abrir()}>
            <Plus />
            Incluir Item
          </Button>
        </Show>
        <Show on="belowLg">
          <Button variant="outline" size="icon" aria-label="Incluir Item" title="Incluir Item" onClick={() => void abrir()}>
            <Plus />
          </Button>
        </Show>
      </HeaderActions>
      <LojaSelect lojas={lojas} value={loja} onChange={setLoja} />
      <Stack direction="row" align="center" gap="field">
        <Switch id="estoque-zerados" checked={zerados} onCheckedChange={(on: boolean) => setZerados(on)} aria-label="Mostrar Itens zerados" />
        <Label htmlFor="estoque-zerados">Mostrar Itens zerados</Label>
      </Stack>
      <DataTable
        scroll="page"
        columns={colunas}
        rows={itens}
        getRowId={(i) => i.id}
        loading={carregando}
        title="Estoque de Pré-vencidos"
        emptyMessage="Nenhum Item no Estoque desta Loja."
        search={{ placeholder: "Buscar produto" }}
        rowActions={(i) => (
          <Stack direction="row" gap="tight">
            <Button size="icon" variant="outline" aria-label={`Editar ${i.nomeProduto}`} onClick={() => void abrir(i)}>
              <Pencil />
            </Button>
            <Button size="icon" variant="outline" tone="destructive" aria-label={`Excluir ${i.nomeProduto}`} onClick={() => void excluir(i)}>
              <Trash2 />
            </Button>
          </Stack>
        )}
      />
    </Stack>
  );
}
