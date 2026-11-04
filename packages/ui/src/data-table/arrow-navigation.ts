import type React from "react";

/** Só os campos de valor: chaves, botões e o checkbox escondido de um Switch ficam fora da navegação. */
const FIELD =
  'input:not([disabled]):not([readonly]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([tabindex="-1"]):not([aria-hidden="true"]), textarea:not([disabled]):not([readonly])';

const focusablesOf = (cell: Element): HTMLElement[] =>
  Array.from(cell.querySelectorAll<HTMLElement>(FIELD)).filter((el) => el.closest("td") === cell);

/** Linhas da mesma tabela da célula (as de tabelas aninhadas ficam de fora). */
const rowsOf = (cell: HTMLTableCellElement): HTMLTableRowElement[] => {
  const body = cell.closest("tbody");
  return body ? Array.from(body.rows).filter((r) => r.cells.length > 0) : [];
};

const focus = (el: HTMLElement | undefined): boolean => {
  if (!el) return false;
  // A célula vai para o meio da tela (vertical e horizontal): nunca fica atrás do cabeçalho ou da coluna fixos.
  el.focus({ preventScroll: true });
  const cell = el.closest("td");
  if (cell && typeof cell.scrollIntoView === "function") cell.scrollIntoView({ block: "center", inline: "center" });
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select();
  return true;
};

/** Ganhou o foco (setas ou clique): seleciona o valor inteiro, então digitar substitui, como numa planilha. */
export function handleArrowNavigationFocus(e: React.FocusEvent<HTMLElement>): void {
  const el = e.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || !el.matches(FIELD)) return;
  el.select();
  // O clique posiciona o cursor depois do foco: seleciona de novo no próximo quadro.
  requestAnimationFrame(() => {
    if (document.activeElement === el) el.select();
  });
}

/**
 * Move o foco entre os campos de valor das células com as setas, como numa planilha: ↑/↓ (e Enter) trocam de
 * linha na mesma célula; ←/→ sempre passam ao campo anterior/seguinte da linha (o valor é sempre substituído ao
 * digitar, nunca editado pelo cursor). Chaves e botões ficam fora. Ligado pelo `arrowNavigation`.
 */
export function handleArrowNavigation(e: React.KeyboardEvent<HTMLElement>): void {
  if (e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
  const target = e.target as HTMLElement;
  if (target.closest('[role="combobox"],[aria-expanded="true"],[role="listbox"],[role="menu"]')) return;
  const cell = target.closest("td");
  if (!cell) return;
  const own = focusablesOf(cell);
  const position = own.indexOf(target);
  if (position < 0) return;

  const vertical = (delta: 1 | -1) => {
    const rows = rowsOf(cell);
    const at = rows.indexOf(cell.parentElement as HTMLTableRowElement);
    for (let i = at + delta; i >= 0 && i < rows.length; i += delta) {
      const other = rows[i]!.cells[cell.cellIndex];
      if (!other) continue;
      const list = focusablesOf(other);
      if (list.length && focus(list[Math.min(position, list.length - 1)])) return true;
    }
    return false;
  };
  const horizontal = (delta: 1 | -1) => {
    const row = cell.parentElement as HTMLTableRowElement;
    const all = Array.from(row.cells).flatMap(focusablesOf);
    return focus(all[all.indexOf(target) + delta]);
  };

  switch (e.key) {
    case "ArrowDown":
    case "ArrowUp":
      vertical(e.key === "ArrowDown" ? 1 : -1);
      // Nunca muda o número do campo nem rola a página: as setas só navegam.
      e.preventDefault();
      return;
    case "ArrowLeft":
    case "ArrowRight":
      // Nem na ponta da linha a seta anda no texto: o valor é sempre substituído ao digitar.
      horizontal(e.key === "ArrowRight" ? 1 : -1);
      e.preventDefault();
      return;
    case "Enter":
      if (vertical(e.shiftKey ? -1 : 1)) e.preventDefault();
      return;
  }
}
