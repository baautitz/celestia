import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@platform/ui/components/button";
import { Stack, Text } from "@platform/ui/components/layout";
import { HeaderActions } from "@platform/ui/context/header-actions";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { FalhaAoCarregar } from "./contexto";
import { resumirLista } from "./lista-produtos-campo";
import { LIMITES_BASE, nomeDoFornecedor, type CadastroLimites, type Fornecedor } from "./pedidos-limites-comum";
import type { RegraLimite } from "./pedidos-limites";
import { RegraLimiteWindow } from "./pedidos-limites-regra-window";
import { useLatestFetch } from "./use-latest-fetch";

/** Aba Regras de Limite: o que cada Limite de Compras controla, com criar, editar e excluir. */
export function PedidosRegrasLimiteTab() {
  const { windows, feedback } = useUi();
  const novaConsulta = useLatestFetch();
  const [cadastro, setCadastro] = useState<CadastroLimites | null>(null);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [falha, setFalha] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const vale = novaConsulta();
    try {
      const r = await apiFetch<CadastroLimites>(LIMITES_BASE);
      if (!vale()) return;
      setCadastro(r);
      setFalha(null);
    } catch (err: unknown) {
      if (!vale()) return;
      const erro = err instanceof Error ? err : new Error("Erro ao carregar as Regras.");
      setFalha(erro.message);
      feedback.notifyError(erro);
    }
  }, [novaConsulta, feedback]);

  useEffect(() => {
    void carregar();
    apiFetch<Fornecedor[]>(`${LIMITES_BASE}/fornecedores`)
      .then(setFornecedores)
      // Sem o ERP, as distribuidoras aparecem pelo código.
      .catch(() => undefined);
  }, [carregar]);

  if (!cadastro) return falha ? <FalhaAoCarregar titulo="Não foi possível carregar as Regras de Limite" descricao={falha} onTentarNovamente={() => void carregar()} /> : <Text tone="muted">Carregando…</Text>;
  const { podeGerir, regras } = cadastro;

  const abrir = async (regra?: RegraLimite) => {
    await windows.open({
      surface: "dialog",
      size: "large",
      title: regra ? "Editar Regra de Limite" : "Nova Regra de Limite",
      content: () => <RegraLimiteWindow regra={regra} fornecedores={fornecedores} />,
    });
    void carregar();
  };

  const excluir = async (regra: RegraLimite) => {
    const ok = await windows.confirm({ title: "Excluir Regra de Limite", description: `Excluir a Regra "${regra.nome}"?`, confirmLabel: "Excluir", destructive: true });
    if (!ok) return;
    try {
      await apiFetch(`${LIMITES_BASE}/regras/${regra.id}?version=${regra.version}`, { method: "DELETE" });
      feedback.notify({ type: "success", title: "Regra de Limite excluída." });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao excluir a Regra."));
    }
    void carregar();
  };

  const colunas: DataTableColumn<RegraLimite>[] = [
    { key: "nome", label: "Nome", value: (r) => r.nome, searchable: true, sortable: true, mobileRole: "primary" },
    { key: "lista", label: "Lista de Produtos", value: (r) => resumirLista(r.entradas) },
    { key: "fornecedores", label: "Distribuidoras", value: (r) => (r.fornecedores.length === 0 ? "Todas" : r.fornecedores.map((c) => nomeDoFornecedor(fornecedores, c)).join(", ")), searchable: true },
  ];

  return (
    <Stack gap="section">
      {podeGerir && (
        <HeaderActions>
          <Button onClick={() => void abrir()}>
            <Plus />
            Nova regra
          </Button>
        </HeaderActions>
      )}
      <DataTable
        title="Regras de Limite"
        columns={colunas}
        rows={regras}
        getRowId={(r) => r.id}
        search={{ placeholder: "Buscar Regra" }}
        emptyMessage="Nenhuma Regra de Limite."
        rowActions={
          podeGerir
            ? (r) => (
                <Stack direction="row" gap="tight">
                  <Button size="icon" variant="outline" aria-label={`Editar Regra ${r.nome}`} onClick={() => void abrir(r)}>
                    <Pencil />
                  </Button>
                  <Button size="icon" variant="outline" tone="destructive" aria-label={`Excluir Regra ${r.nome}`} onClick={() => void excluir(r)}>
                    <Trash2 />
                  </Button>
                </Stack>
              )
            : undefined
        }
      />
    </Stack>
  );
}
