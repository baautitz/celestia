import { randomUUID } from "node:crypto";
import { mesmoNome, NomeDuplicadoError } from "./erros-de-store.js";
import type { DadosVisaoPedidos, VisaoPedidos } from "./pedidos-visoes.js";

export interface PedidosVisoesStore {
  /** As visões do Usuário, por nome. */
  listar(usuarioId: string): Promise<VisaoPedidos[]>;
  visao(usuarioId: string, id: string): Promise<VisaoPedidos | null>;
  /** Lança `NomeDuplicadoError` se o Usuário já tem uma visão com o nome. Com `padrao`, tira a marca das outras dele. */
  criar(usuarioId: string, dados: DadosVisaoPedidos): Promise<VisaoPedidos>;
  /** Compare-and-set pela `version`; null se a visão mudou, sumiu ou é de outro Usuário. */
  atualizar(usuarioId: string, id: string, dados: DadosVisaoPedidos, expectedVersion: number): Promise<VisaoPedidos | null>;
  remover(usuarioId: string, id: string, expectedVersion: number): Promise<boolean>;
}

export const novoIdVisaoPedidos = (): string => `ppv_${randomUUID()}`;

export const ordenarVisoes = <V extends Pick<VisaoPedidos, "nome">>(visoes: V[]): V[] => [...visoes].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

export class MemoryPedidosVisoesStore implements PedidosVisoesStore {
  private readonly visoes = new Map<string, VisaoPedidos>();

  async listar(usuarioId: string): Promise<VisaoPedidos[]> {
    return ordenarVisoes([...this.visoes.values()].filter((v) => v.usuarioId === usuarioId));
  }

  async visao(usuarioId: string, id: string): Promise<VisaoPedidos | null> {
    const v = this.visoes.get(id);
    return v && v.usuarioId === usuarioId ? v : null;
  }

  async criar(usuarioId: string, dados: DadosVisaoPedidos): Promise<VisaoPedidos> {
    this.garantirNomeUnico(usuarioId, dados.nome);
    const visao = { ...dados, id: novoIdVisaoPedidos(), usuarioId, version: 1 };
    this.limparPadrao(usuarioId, dados.padrao, visao.id);
    this.visoes.set(visao.id, visao);
    return visao;
  }

  async atualizar(usuarioId: string, id: string, dados: DadosVisaoPedidos, expectedVersion: number): Promise<VisaoPedidos | null> {
    const atual = await this.visao(usuarioId, id);
    if (!atual || atual.version !== expectedVersion) return null;
    this.garantirNomeUnico(usuarioId, dados.nome, id);
    this.limparPadrao(usuarioId, dados.padrao, id);
    const atualizada = { ...atual, ...dados, version: atual.version + 1 };
    this.visoes.set(id, atualizada);
    return atualizada;
  }

  async remover(usuarioId: string, id: string, expectedVersion: number): Promise<boolean> {
    const atual = await this.visao(usuarioId, id);
    if (!atual || atual.version !== expectedVersion) return false;
    return this.visoes.delete(id);
  }

  private limparPadrao(usuarioId: string, padrao: boolean, exceto: string): void {
    if (!padrao) return;
    for (const v of this.visoes.values()) if (v.usuarioId === usuarioId && v.id !== exceto && v.padrao) this.visoes.set(v.id, { ...v, padrao: false, version: v.version + 1 });
  }

  private garantirNomeUnico(usuarioId: string, nome: string, id?: string): void {
    if ([...this.visoes.values()].some((v) => v.usuarioId === usuarioId && v.id !== id && mesmoNome(v.nome, nome))) throw new NomeDuplicadoError();
  }
}
