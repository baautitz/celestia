import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@platform/ui/components/badge";
import { Button } from "@platform/ui/components/button";
import { Stack, Text } from "@platform/ui/components/layout";
import { HeaderActions } from "@platform/ui/context/header-actions";
import { DataTable, type DataTableColumn } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { apiFetch } from "@platform/ui/lib/api";
import { FalhaAoCarregar } from "./contexto";
import { dataBr } from "./datas";
import { LIMITES_BASE, nomeDaLoja, type CadastroLimites, type SaldoLimite } from "./pedidos-limites-comum";
import type { ValorLimite } from "./pedidos-limites";
import { ValorLimiteWindow } from "./pedidos-limites-valor-window";
import { useLatestFetch } from "./use-latest-fetch";

/** Uma linha por saldo: o Valor "Por Loja" ocupa uma linha por Loja. */
interface Linha {
  id: string;
  valor: ValorLimite;
  regra: string;
  codigoLoja: number | null;
  valorCentavos: number;
  /** Ausente enquanto o consumo não chega do ERP (ou se ele falhar). */
  saldo?: SaldoLimite;
}

const linhasDe = (cadastro: CadastroLimites, consumos: Record<string, SaldoLimite[]>): Linha[] =>
  cadastro.valores.flatMap((valor) => {
    const regra = cadastro.regras.find((r) => r.id === valor.regraId)?.nome ?? "";
    const partes = valor.distribuicao.tipo === "todas" ? [{ codigoLoja: null, valorCentavos: valor.distribuicao.valorCentavos }] : valor.distribuicao.lojas;
    return partes.map((p) => ({ id: `${valor.id}:${p.codigoLoja ?? "todas"}`, valor, regra, ...p, saldo: consumos[valor.id]?.find((s) => s.codigoLoja === p.codigoLoja) }));
  });

const reais = (centavos: number | undefined) => (centavos === undefined ? null : centavos / 100);

/** Aba Limites: cada Valor do Limite de Compras com o consumo e o saldo, calculados ao vivo com o ERP. */
export function PedidosLimitesTab() {
  const { windows, feedback } = useUi();
  const novaConsulta = useLatestFetch();
  const [cadastro, setCadastro] = useState<CadastroLimites | null>(null);
  const [consumos, setConsumos] = useState<Record<string, SaldoLimite[]>>({});
  const [falha, setFalha] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const vale = novaConsulta();
    try {
      const recebido = await apiFetch<CadastroLimites>(LIMITES_BASE);
      if (!vale()) return;
      setCadastro(recebido);
      setFalha(null);
      setConsumos({});
      // Um por vez, para não disparar todas as consultas no ERP juntas.
      let avisado = false;
      for (const valor of recebido.valores) {
        try {
          const saldos = await apiFetch<SaldoLimite[]>(`${LIMITES_BASE}/valores/${valor.id}/consumo`);
          if (!vale()) return;
          setConsumos((atuais) => ({ ...atuais, [valor.id]: saldos }));
        } catch (err: unknown) {
          if (!vale()) return;
          if (!avisado) feedback.notifyError(err instanceof Error ? err : new Error("Erro ao calcular o consumo do Limite."));
          avisado = true;
        }
      }
    } catch (err: unknown) {
      if (vale()) setFalha(err instanceof Error ? err.message : "Erro ao carregar os Limites.");
    }
  }, [novaConsulta, feedback]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!cadastro) return falha ? <FalhaAoCarregar titulo="Não foi possível carregar os Limites" descricao={falha} onTentarNovamente={() => void carregar()} /> : <Text tone="muted">Carregando…</Text>;

  const abrirValor = async (valor?: ValorLimite) => {
    await windows.open({
      surface: "dialog",
      title: valor ? "Editar Valor do Limite" : "Novo Valor do Limite",
      description: "Quanto se pode comprar de uma Regra na vigência.",
      content: () => <ValorLimiteWindow valor={valor} regras={cadastro.regras} lojas={cadastro.lojas} />,
    });
    void carregar();
  };

  const excluir = async (valor: ValorLimite, regra: string) => {
    const ok = await windows.confirm({
      title: "Excluir Valor do Limite",
      description: `Excluir o Valor da Regra "${regra}" de ${dataBr(valor.inicio)} a ${dataBr(valor.fim)}${valor.distribuicao.tipo === "porLoja" ? ", de todas as Lojas dele" : ""}?`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`${LIMITES_BASE}/valores/${valor.id}?version=${valor.version}`, { method: "DELETE" });
      feedback.notify({ type: "success", title: "Valor do Limite excluído." });
    } catch (err: unknown) {
      feedback.notifyError(err instanceof Error ? err : new Error("Erro ao excluir o Valor do Limite."));
    }
    void carregar();
  };

  const dinheiro = (key: string, label: string, centavos: (l: Linha) => number | undefined): DataTableColumn<Linha> => ({ key, label, format: "currency", value: (l) => reais(centavos(l)), sortable: true });
  const colunas: DataTableColumn<Linha>[] = [
    { key: "regra", label: "Regra", value: (l) => l.regra, searchable: true, sortable: true, mobileRole: "primary" },
    { key: "vigencia", label: "Vigência", value: (l) => `${dataBr(l.valor.inicio)} a ${dataBr(l.valor.fim)}`, nowrap: true },
    { key: "loja", label: "Loja", value: (l) => (l.codigoLoja === null ? "Todas as Lojas" : nomeDaLoja(cadastro.lojas, l.codigoLoja)), searchable: true },
    dinheiro("valor", "Valor", (l) => l.valorCentavos),
    dinheiro("entradas", "Entradas", (l) => l.saldo?.entradasCentavos),
    dinheiro("comprometido", "Comprometido", (l) => l.saldo?.comprometidoCentavos),
    dinheiro("reposto", "Reposto", (l) => l.saldo?.repostoCentavos),
    {
      ...dinheiro("saldo", "Saldo", (l) => l.saldo?.saldoCentavos),
      render: (l) => {
        if (!l.saldo) return "—";
        const texto = (l.saldo.saldoCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        return l.saldo.saldoCentavos < 0 ? <Badge variant="destructive">{texto}</Badge> : texto;
      },
    },
  ];

  return (
    <Stack gap="section">
      {cadastro.podeGerir && (
        <HeaderActions>
          <Button disabled={cadastro.regras.length === 0} onClick={() => void abrirValor()}>
            <Plus />
            Novo valor
          </Button>
        </HeaderActions>
      )}
      <DataTable
        title="Limites de Compras"
        columns={colunas}
        rows={linhasDe(cadastro, consumos)}
        getRowId={(l) => l.id}
        search={{ placeholder: "Buscar Regra ou Loja" }}
        emptyMessage={cadastro.regras.length === 0 ? "Nenhuma Regra de Limite. Comece pela aba Regras de Limite." : "Nenhum Valor lançado. Use Novo valor."}
        rowActions={
          cadastro.podeGerir
            ? (l) => (
                <Stack direction="row" gap="tight">
                  <Button size="icon" variant="outline" aria-label={`Editar Valor de ${l.regra} de ${dataBr(l.valor.inicio)}`} onClick={() => void abrirValor(l.valor)}>
                    <Pencil />
                  </Button>
                  <Button size="icon" variant="outline" tone="destructive" aria-label={`Excluir Valor de ${l.regra} de ${dataBr(l.valor.inicio)}`} onClick={() => void excluir(l.valor, l.regra)}>
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
