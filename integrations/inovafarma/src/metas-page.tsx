import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { Stack } from "@platform/ui/components/layout";
import { Tabs, TabsList, TabsTrigger } from "@platform/ui/components/tabs";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { HeaderActions } from "@platform/ui/context/header-actions";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { AlvoPadraoWindow } from "./alvo-padrao-window";
import { formatarValor, indicadorPorId } from "./indicadores";
import { EXIBICAO_LABEL } from "./tipos-meta";
import { BASE, TipoMetaWindow, type TipoMetaComPremio, type TipoMetaSalvo } from "./tipo-meta-window";

/** Aba Tipos de Meta: cadastro dos Tipos com a prévia do Prêmio. */
function TiposDeMeta() {
  const { feedback, windows } = useUi();
  const [tipos, setTipos] = useState<TipoMetaComPremio[]>([]);
  const [carregando, setCarregando] = useState(true);
  const consulta = useRef(0);

  const carregar = useCallback(async () => {
    const minha = ++consulta.current;
    setCarregando(true);
    try {
      const lista = await apiFetch<TipoMetaComPremio[]>(BASE);
      if (minha === consulta.current) setTipos(lista);
    } catch (err: unknown) {
      if (minha === consulta.current) feedback.notifyError(err instanceof Error ? err : new Error("Erro ao carregar os Tipos de Meta."));
    } finally {
      if (minha === consulta.current) setCarregando(false);
    }
  }, [feedback]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const abrir = async (tipo?: TipoMetaComPremio) => {
    const resultado = await windows.open<TipoMetaSalvo>({
      surface: "sheet",
      title: tipo ? "Alterar Tipo de Meta" : "Novo Tipo de Meta",
      description: "Indicador, Exibição e regra do Prêmio. Uma alteração afeta só os Períodos abertos.",
      content: () => <TipoMetaWindow tipo={tipo} />,
    });
    void carregar();
    if (resultado.status !== "confirmed" || !resultado.value.alvoPadraoMudou) return;
    const salvo = resultado.value.tipo;
    await windows.open<true>({
      surface: "dialog",
      title: salvo.indicador === "avaliacoes" ? "Aplicar o novo valor inicial" : "Aplicar o novo Alvo padrão",
      description: `Tipo de Meta "${salvo.nome}"`,
      content: () => <AlvoPadraoWindow tipo={salvo} />,
    });
  };

  const colunas: DataTableColumn<TipoMetaComPremio>[] = [
    { key: "nome", label: "Tipo de Meta", value: (t) => t.nome, searchable: true, sortable: true, mobileRole: "primary" },
    { key: "indicador", label: "Indicador", value: (t) => indicadorPorId(t.indicador).nome, searchable: true, sortable: true },
    { key: "exibicao", label: "Exibição", value: (t) => EXIBICAO_LABEL[t.exibicao] },
    { key: "premio", label: "Prêmio", value: (t) => t.premio, searchable: true },
    {
      key: "alvoPadrao",
      label: "Alvo padrão",
      value: (t) => (t.semAlvo ? "Sem Alvo" : t.alvoPadrao === null ? "" : formatarValor(indicadorPorId(t.indicador), t.alvoPadrao)),
    },
    {
      key: "ativo",
      label: "Situação",
      value: (t) => (t.ativo ? "Ativo" : "Inativo"),
      render: (t) => <Badge variant={t.ativo ? "success" : "secondary"}>{t.ativo ? "Ativo" : "Inativo"}</Badge>,
    },
  ];

  return (
    <Stack gap="section">
      <HeaderActions>
        <Button onClick={() => void abrir()}>
          <Plus />
          Novo Tipo de Meta
        </Button>
      </HeaderActions>
      <DataTable
        columns={colunas}
        rows={tipos}
        getRowId={(t) => t.id}
        loading={carregando}
        title="Tipos de Meta"
        description="Um Tipo de Meta inativo sai do montador de Metas, mas continua nas Metas que já o usam."
        emptyMessage="Nenhum Tipo de Meta cadastrado."
        search={{ placeholder: "Buscar Tipo de Meta ou Indicador" }}
        rowActions={(t) => (
          <Button size="icon" variant="ghost" aria-label={`Alterar Tipo de Meta ${t.nome}`} onClick={() => void abrir(t)}>
            <Pencil />
          </Button>
        )}
      />
    </Stack>
  );
}

/** Página Metas: construtor de Metas do InovaFarma. As próximas abas (Montar Metas, Acompanhamento, Minhas Metas) entram aqui. */
export function MetasPage() {
  return (
    <Stack gap="section">
      <Tabs value="tipos">
        <TabsList>
          <TabsTrigger value="tipos">Tipos de Meta</TabsTrigger>
        </TabsList>
      </Tabs>
      <TiposDeMeta />
    </Stack>
  );
}
