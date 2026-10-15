export interface GraphNode {
  id: string;
  dependsOn?: string[];
}

/** Ordena topologicamente (dependências primeiro; estável pela ordem de entrada). */
export function topoSort<T extends GraphNode>(nodes: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const n of nodes) {
    if (byId.has(n.id)) throw new Error(`Módulo duplicado: "${n.id}".`);
    byId.set(n.id, n);
  }
  const out: T[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (n: T, path: string[]): void => {
    if (state.get(n.id) === "done") return;
    if (state.get(n.id) === "visiting") {
      throw new Error(`Dependência circular entre módulos: ${[...path, n.id].join(" -> ")}.`);
    }
    state.set(n.id, "visiting");
    for (const dep of n.dependsOn ?? []) {
      const d = byId.get(dep);
      if (!d) throw new Error(`O módulo "${n.id}" depende de "${dep}", que não existe.`);
      visit(d, [...path, n.id]);
    }
    state.set(n.id, "done");
    out.push(n);
  };
  for (const n of nodes) visit(n, []);
  return out;
}
