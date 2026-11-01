import { randomUUID } from "node:crypto";

/** Motivo do Ajuste: item da lista que classifica as Justificativas. Desativado, sai das opções mas segue nas Justificativas. */
export interface MotivoAjuste {
  id: string;
  nome: string;
  ativo: boolean;
  version: number;
  criadoEm: string;
  atualizadoEm: string;
}

/** Justificativa do Ajuste: explica um Ajuste de Estoque inteiro (`CodigoMovimento` do ERP) num Closing Period. */
export interface JustificativaAjuste {
  id: string;
  periodoId: string;
  codigoMovimento: number;
  /** Loja do Ajuste no ERP, guardada para filtrar e auditar sem consultar o ERP. */
  codigoLoja: number;
  motivoId: string;
  observacao: string | null;
  criadoPor: string;
  version: number;
  criadoEm: string;
  atualizadoEm: string;
}

export type NovaJustificativa = Omit<JustificativaAjuste, "id" | "version" | "criadoEm" | "atualizadoEm">;
export type EdicaoJustificativa = Pick<JustificativaAjuste, "motivoId" | "observacao">;
export type EdicaoMotivo = Pick<MotivoAjuste, "nome" | "ativo">;

export interface FuroEstoqueStore {
  listarMotivos(): Promise<MotivoAjuste[]>;
  criarMotivo(nome: string): Promise<MotivoAjuste>;
  /** Compare-and-set pela `version`; null se o Motivo mudou ou sumiu. */
  atualizarMotivo(id: string, valores: EdicaoMotivo, expectedVersion: number): Promise<MotivoAjuste | null>;
  listarJustificativas(periodoId: string): Promise<JustificativaAjuste[]>;
  justificativa(id: string): Promise<JustificativaAjuste | null>;
  /** null se o Ajuste já tem Justificativa. */
  justificar(nova: NovaJustificativa): Promise<JustificativaAjuste | null>;
  /** Compare-and-set pela `version`; null se a Justificativa mudou ou sumiu. */
  atualizarJustificativa(id: string, valores: EdicaoJustificativa, expectedVersion: number): Promise<JustificativaAjuste | null>;
  /** Compare-and-set pela `version`; false se a Justificativa mudou ou sumiu. */
  excluirJustificativa(id: string, expectedVersion: number): Promise<boolean>;
}

export const novoIdMotivo = (): string => `mot_${randomUUID()}`;
export const novoIdJustificativa = (): string => `jus_${randomUUID()}`;

/** Motivos iniciais, os mesmos que a migration semeia no Postgres. */
export const MOTIVOS_INICIAIS = ["Vencido", "Avaria / Quebra", "Erro de contagem", "Uso interno", "Fracionamento / Kit", "Troca", "Outros"];

export class MemoryFuroEstoqueStore implements FuroEstoqueStore {
  private readonly motivos = new Map<string, MotivoAjuste>();
  private readonly justificativas = new Map<string, JustificativaAjuste>();

  constructor(motivosIniciais: string[] = MOTIVOS_INICIAIS) {
    for (const nome of motivosIniciais) {
      const agora = new Date().toISOString();
      const motivo = { id: novoIdMotivo(), nome, ativo: true, version: 1, criadoEm: agora, atualizadoEm: agora };
      this.motivos.set(motivo.id, motivo);
    }
  }

  async listarMotivos(): Promise<MotivoAjuste[]> {
    return [...this.motivos.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  }

  async criarMotivo(nome: string): Promise<MotivoAjuste> {
    const agora = new Date().toISOString();
    const motivo = { id: novoIdMotivo(), nome, ativo: true, version: 1, criadoEm: agora, atualizadoEm: agora };
    this.motivos.set(motivo.id, motivo);
    return motivo;
  }

  async atualizarMotivo(id: string, valores: EdicaoMotivo, expectedVersion: number): Promise<MotivoAjuste | null> {
    const atual = this.motivos.get(id);
    if (!atual || atual.version !== expectedVersion) return null;
    const atualizado = { ...atual, ...valores, version: atual.version + 1, atualizadoEm: new Date().toISOString() };
    this.motivos.set(id, atualizado);
    return atualizado;
  }

  async listarJustificativas(periodoId: string): Promise<JustificativaAjuste[]> {
    return [...this.justificativas.values()].filter((j) => j.periodoId === periodoId);
  }

  async justificativa(id: string): Promise<JustificativaAjuste | null> {
    return this.justificativas.get(id) ?? null;
  }

  async justificar(nova: NovaJustificativa): Promise<JustificativaAjuste | null> {
    if ([...this.justificativas.values()].some((j) => j.codigoMovimento === nova.codigoMovimento)) return null;
    const agora = new Date().toISOString();
    const justificativa = { ...nova, id: novoIdJustificativa(), version: 1, criadoEm: agora, atualizadoEm: agora };
    this.justificativas.set(justificativa.id, justificativa);
    return justificativa;
  }

  async atualizarJustificativa(id: string, valores: EdicaoJustificativa, expectedVersion: number): Promise<JustificativaAjuste | null> {
    const atual = this.justificativas.get(id);
    if (!atual || atual.version !== expectedVersion) return null;
    const atualizada = { ...atual, ...valores, version: atual.version + 1, atualizadoEm: new Date().toISOString() };
    this.justificativas.set(id, atualizada);
    return atualizada;
  }

  async excluirJustificativa(id: string, expectedVersion: number): Promise<boolean> {
    const atual = this.justificativas.get(id);
    if (!atual || atual.version !== expectedVersion) return false;
    return this.justificativas.delete(id);
  }
}
