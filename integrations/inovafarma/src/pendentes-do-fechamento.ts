import type { UsersService } from "./colaboradores-routes.js";

/** Limite do que fica guardado entre o `before` e o `after` do fechamento: um fechamento recusado depois do `before` deixa a entrada. */
const MAX_PENDENTES = 100;

/** Id do Closing Period no payload dos eventos `closing_period.close` e `closing_period.reopen`. */
export const periodoDoPayload = (payload: object): string => (payload as { periodId?: string }).periodId ?? "";

/** Quem fechou ou reabriu o Período, como autor de uma entrada no Audit Log. */
export const atorDoEvento = async (users: UsersService, payload: object) => {
  const id = (payload as { actorId?: string }).actorId ?? "";
  return { id, name: (await users.list()).find((u) => u.id === id)?.fullname ?? "" };
};

/**
 * O que o `before` do fechamento calculou (só lendo) e o `after` grava (ADR 0007): fica na memória por Período, limitado.
 * Um fechamento recusado depois do `before` (ex.: conflito de versão) deixa a entrada, que o próximo fechamento do mesmo
 * Período substitui.
 */
export function pendentesDoFechamento<T>() {
  const pendentes = new Map<string, T>();
  return {
    guardar(periodoId: string, valor: T): void {
      pendentes.delete(periodoId);
      if (pendentes.size >= MAX_PENDENTES) {
        const [maisAntigo] = pendentes.keys();
        if (maisAntigo !== undefined) pendentes.delete(maisAntigo);
      }
      pendentes.set(periodoId, valor);
    },
    /** O que o `before` guardou do Período, que sai da memória; undefined se não guardou. */
    retirar(periodoId: string): T | undefined {
      const valor = pendentes.get(periodoId);
      pendentes.delete(periodoId);
      return valor;
    },
  };
}
