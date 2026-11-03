import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Button } from "@platform/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@platform/ui/components/dropdown-menu";
import { Label } from "@platform/ui/components/label";
import { Show, Stack } from "@platform/ui/components/layout";
import { Switch } from "@platform/ui/components/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import { HeaderActions } from "@platform/ui/context/header-actions";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { formatDate } from "@platform/ui/lib/format";
import { ItemPreVencidoWindow, type ItemPreVencido, type ItemSalvo } from "./item-pre-vencido-window";
import type { LojaOpcao } from "./loja-opcao";

const BASE = "/api/m/inovafarma/pre-vencidos";

const validadeLabel = (validade: string) => validade.split("-").reverse().join("/");

/** Aba Estoque: os Itens de Pré-vencido de uma Loja do Vínculo, com inclusão, edição e exclusão em janela. */
export function EstoquePreVencidosTab({ lojas }: { lojas: LojaOpcao[] }) {
  const { feedback, windows } = useUi();
  const [loja, setLoja] = useState(lojas.length > 0 ? String(lojas[0]!.codigo) : "");
  const [zerados, setZerados] = useState(false);
  const [itens, setItens] = useState<ItemPreVencido[]>([]);
  const [carregando, setCarregando] = useState(false);

  // Só a resposta da última consulta vale: uma resposta atrasada não apaga o que uma consulta mais nova trouxe.
  const consulta = useRef(0);
  const carregar = useCallback(async () => {
    if (!loja) return;
    const minha = ++consulta.current;
    setCarregando(true);
    try {
      const recebidos = await apiFetch<ItemPreVencido[]>(`${BASE}/estoque/itens?codigoLoja=${encodeURIComponent(loja)}${zerados ? "&zerados=true" : ""}`);
      if (minha === consulta.current) setItens(recebidos);
    } catch (err: unknown) {
      if (minha === consulta.current) feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar o Estoque de Pré-vencidos."));
    } finally {
      if (minha === consulta.current) setCarregando(false);
    }
  }, [loja, zerados, feedback]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (lojas.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Sem Lojas</AlertTitle>
        <AlertDescription>Seu Usuário não está vinculado a um Colaborador com Lojas. Peça o vínculo a quem administra os Colaboradores.</AlertDescription>
      </Alert>
    );
  }

  const abrir = async (item?: ItemPreVencido) => {
    const resultado = await windows.open<ItemSalvo>({
      surface: "dialog",
      size: "small",
      title: item ? "Editar Item" : "Incluir Item",
      description: item ? item.nomeProduto : "Inclua um Pré-vencido que está na prateleira da Loja.",
      content: () => <ItemPreVencidoWindow codigoLoja={Number(loja)} item={item} />,
    });
    if (resultado.status !== "confirmed") return;
    // O Item salvo já aparece na tabela; a recarga confirma com o servidor.
    const salvo = resultado.value;
    if (String(salvo.codigoLoja) === loja) {
      // A edição volta sem o Restante, que depende das vendas: fica o anterior até a recarga.
      setItens((atuais) =>
        atuais.some((i) => i.id === salvo.id) ? atuais.map((i) => (i.id === salvo.id ? { ...i, ...salvo } : i)) : [...atuais, { ...salvo, restante: salvo.restante ?? salvo.quantidade }],
      );
    }
    void carregar();
  };

  const excluir = async (item: ItemPreVencido) => {
    const ok = await windows.confirm({
      title: "Excluir Item",
      description: `Excluir o Item de ${item.quantidade} un. de "${item.nomeProduto}" (validade ${validadeLabel(item.validade)})?`,
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
    { key: "validade", centered: true, label: "Validade", value: (i) => i.validade, render: (i) => validadeLabel(i.validade), sortable: true },
    { key: "quantidade", label: "Quantidade", value: (i) => i.quantidade, format: "number", sortable: true },
    { key: "restante", label: "Restante", value: (i) => i.restante, format: "number", sortable: true },
    { key: "incluidoEm", centered: true, label: "Incluído em", value: (i) => i.incluidoEm, render: (i) => formatDate(i.incluidoEm), sortable: true },
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
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Mais ações" />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void abrir()}>
                <Plus />
                Incluir Item
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Show>
      </HeaderActions>
      <Stack gap="field">
        <Label>Loja</Label>
        <Select value={loja} onValueChange={(v) => v && setLoja(v)}>
          <SelectTrigger aria-label="Loja">
            <SelectValue>{(v: string) => lojas.find((l) => String(l.codigo) === v)?.nome || `Loja ${v}`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {lojas.map((l) => (
              <SelectItem key={l.codigo} value={String(l.codigo)}>
                {l.nome || `Loja ${l.codigo}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Stack>
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
            <Button size="icon" variant="ghost" aria-label={`Editar ${i.nomeProduto}`} onClick={() => void abrir(i)}>
              <Pencil />
            </Button>
            <Button size="icon" variant="ghost" tone="destructive" aria-label={`Excluir ${i.nomeProduto}`} onClick={() => void excluir(i)}>
              <Trash2 />
            </Button>
          </Stack>
        )}
      />
    </Stack>
  );
}
