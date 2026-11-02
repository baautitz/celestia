import { useState } from "react";
import { Input } from "@platform/ui/components/input";
import { MoneyInput } from "@platform/ui/components/money-input";
import type { Indicador } from "./indicadores";

/** Rótulo do valor do Participante: valor inicial na Meta de Avaliações, Alvo nas demais. */
export const rotuloAlvo = (indicador: Pick<Indicador, "id" | "unidade">): string =>
  indicador.id === "avaliacoes" ? "Valor inicial (em R$)" : `Alvo (${indicador.unidade === "percentual" ? "em %" : indicador.unidade === "reais" ? "em R$" : "quantidade"})`;

const numero = (texto: string): number | null => {
  const n = Number(texto.trim().replace(/\./g, "").replace(",", "."));
  return texto.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

/** Campo do Alvo na unidade do Indicador (R$ em centavos, como a API). null: em branco. */
export function AlvoInput({
  indicador,
  valor,
  onChange,
  label,
  autoFocus,
}: {
  indicador: Indicador;
  valor: number | null;
  onChange: (alvo: number | null) => void;
  label: string;
  autoFocus?: boolean;
}) {
  const [texto, setTexto] = useState(valor === null ? "" : String(valor).replace(".", ","));
  if (indicador.unidade === "reais")
    return (
      <MoneyInput autoFocus={autoFocus} value={valor === null ? null : valor / 100} onValueChange={(v) => onChange(v > 0 ? Math.round(v * 100) : null)} aria-label={label} />
    );
  return (
    <Input
      autoFocus={autoFocus}
      inputMode="decimal"
      value={texto}
      aria-label={label}
      onChange={(e) => {
        setTexto(e.target.value);
        onChange(numero(e.target.value));
      }}
    />
  );
}
