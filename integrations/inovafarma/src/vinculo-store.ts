/** Vínculo do Colaborador: a existência do registro é o que torna o Colaborador "Confirmado". */
export interface VinculoColaborador {
  codigoColaborador: number;
  /** Referência lógica a `iam.users`, sem FK entre Modules. */
  usuarioId: string | null;
  version: number;
  atualizadoPor: string;
  atualizadoEm: string;
}

export interface GravarVinculo {
  codigoColaborador: number;
  usuarioId: string | null;
  atualizadoPor: string;
}

/** A `version` armazenada não é a esperada (compare-and-set falhou). */
export class VersaoDesatualizadaError extends Error {}

/** O Usuário já está em outro vínculo. */
export class UsuarioJaVinculadoError extends Error {}

/** Persistência dos vínculos. `expectedVersion` 0 significa que ainda não há vínculo gravado. */
export interface VinculoStore {
  list(): Promise<VinculoColaborador[]>;
  get(codigoColaborador: number): Promise<VinculoColaborador | null>;
  /** Cria ou altera de forma atômica; lança `VersaoDesatualizadaError` ou `UsuarioJaVinculadoError`. */
  gravar(input: GravarVinculo, expectedVersion: number): Promise<VinculoColaborador>;
  /** Desfaz o vínculo de forma atômica; lança `VersaoDesatualizadaError`. */
  remover(codigoColaborador: number, expectedVersion: number): Promise<void>;
}

export class MemoryVinculoStore implements VinculoStore {
  private readonly vinculos = new Map<number, VinculoColaborador>();

  async list(): Promise<VinculoColaborador[]> {
    return [...this.vinculos.values()];
  }

  async get(codigoColaborador: number): Promise<VinculoColaborador | null> {
    return this.vinculos.get(codigoColaborador) ?? null;
  }

  async gravar(input: GravarVinculo, expectedVersion: number): Promise<VinculoColaborador> {
    this.assertVersao(input.codigoColaborador, expectedVersion);
    const emOutro = [...this.vinculos.values()].some(
      (v) => input.usuarioId !== null && v.usuarioId === input.usuarioId && v.codigoColaborador !== input.codigoColaborador,
    );
    if (emOutro) throw new UsuarioJaVinculadoError();
    const vinculo = { ...input, version: expectedVersion + 1, atualizadoEm: new Date().toISOString() };
    this.vinculos.set(input.codigoColaborador, vinculo);
    return vinculo;
  }

  async remover(codigoColaborador: number, expectedVersion: number): Promise<void> {
    this.assertVersao(codigoColaborador, expectedVersion);
    this.vinculos.delete(codigoColaborador);
  }

  private assertVersao(codigoColaborador: number, expectedVersion: number): void {
    if ((this.vinculos.get(codigoColaborador)?.version ?? 0) !== expectedVersion) throw new VersaoDesatualizadaError();
  }
}
