/**
 * Vínculo do Colaborador. Um registro com Usuário ou Lojas torna o Colaborador "Confirmado".
 * Desfazer mantém o registro vazio, só para a `version` continuar crescendo: recriar o vínculo não a reinicia.
 */
export interface VinculoColaborador {
  codigoColaborador: number;
  /** Referência lógica a `iam.users`, sem FK entre Modules. */
  usuarioId: string | null;
  /** Códigos das Lojas onde trabalha, em ordem crescente; zero ou mais, sem Loja principal. */
  lojas: number[];
  version: number;
  atualizadoPor: string;
  atualizadoEm: string;
}

export interface GravarVinculo {
  codigoColaborador: number;
  usuarioId: string | null;
  lojas: number[];
  atualizadoPor: string;
}

/** Registro de um vínculo desfeito: para todos os efeitos o Colaborador está "Pendente". */
export const vinculoDesfeito = ({ usuarioId, lojas }: Pick<VinculoColaborador, "usuarioId" | "lojas">): boolean => usuarioId === null && lojas.length === 0;

/** A `version` armazenada não é a esperada (compare-and-set falhou). */
export class VersaoDesatualizadaError extends Error {}

/** O Usuário já está em outro vínculo. */
export class UsuarioJaVinculadoError extends Error {}

/** Persistência dos vínculos. `expectedVersion` 0 significa que ainda não há registro. */
export interface VinculoStore {
  list(): Promise<VinculoColaborador[]>;
  get(codigoColaborador: number): Promise<VinculoColaborador | null>;
  /** Cria ou altera de forma atômica; lança `VersaoDesatualizadaError` ou `UsuarioJaVinculadoError`. */
  gravar(input: GravarVinculo, expectedVersion: number): Promise<VinculoColaborador>;
  /** Esvazia o registro de forma atômica, incrementando a `version`; lança `VersaoDesatualizadaError`, também se não há registro. */
  desfazer(codigoColaborador: number, expectedVersion: number, atualizadoPor: string): Promise<VinculoColaborador>;
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

  async desfazer(codigoColaborador: number, expectedVersion: number, atualizadoPor: string): Promise<VinculoColaborador> {
    if (expectedVersion === 0) throw new VersaoDesatualizadaError();
    return this.gravar({ codigoColaborador, usuarioId: null, lojas: [], atualizadoPor }, expectedVersion);
  }

  private assertVersao(codigoColaborador: number, expectedVersion: number): void {
    if ((this.vinculos.get(codigoColaborador)?.version ?? 0) !== expectedVersion) throw new VersaoDesatualizadaError();
  }
}
