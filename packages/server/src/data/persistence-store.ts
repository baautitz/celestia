export interface PersistenceItem {
  id: string;
  workspaceId: string;
  collectionId: string;
  targetForeignKey: string | number;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PersistenceStore {
  /**
   * Obtém todos os itens de uma coleção 1:N no workspace, opcionalmente filtrados por foreignKey.
   */
  getItems(
    workspaceId: string,
    collectionId: string,
    targetForeignKey?: string | number
  ): Promise<PersistenceItem[]>;

  /**
   * Obtém o registro escalar 1:1 de uma chave no workspace.
   */
  getScalar(
    workspaceId: string,
    collectionId: string,
    targetForeignKey: string | number
  ): Promise<Record<string, unknown> | null>;

  /**
   * Insere um novo item em uma coleção 1:N.
   */
  pushItem(
    workspaceId: string,
    collectionId: string,
    targetForeignKey: string | number,
    data: Record<string, unknown>
  ): Promise<PersistenceItem>;

  /**
   * Define ou atualiza um registro escalar 1:1.
   */
  setScalar(
    workspaceId: string,
    collectionId: string,
    targetForeignKey: string | number,
    data: Record<string, unknown>
  ): Promise<PersistenceItem>;

  /**
   * Remove um item pelo seu ID único.
   */
  deleteItem(workspaceId: string, collectionId: string, itemId: string | number): Promise<void>;

  /**
   * Limpa os dados de um workspace (para testes).
   */
  clear(workspaceId?: string): Promise<void>;
}

/**
 * Armazenamento de Persistência em Memória para testes no Vitest.
 */
export class MemoryPersistenceStore implements PersistenceStore {
  private items: PersistenceItem[] = [];
  private idCounter = 1;

  async getItems(
    workspaceId: string,
    collectionId: string,
    targetForeignKey?: string | number
  ): Promise<PersistenceItem[]> {
    return this.items.filter((item) => {
      const matchWs = item.workspaceId === workspaceId;
      const matchCol = item.collectionId === collectionId;
      const matchFk =
        targetForeignKey !== undefined
          ? String(item.targetForeignKey) === String(targetForeignKey)
          : true;
      return matchWs && matchCol && matchFk;
    });
  }

  async getScalar(
    workspaceId: string,
    collectionId: string,
    targetForeignKey: string | number
  ): Promise<Record<string, unknown> | null> {
    const found = this.items.find(
      (item) =>
        item.workspaceId === workspaceId &&
        item.collectionId === collectionId &&
        String(item.targetForeignKey) === String(targetForeignKey)
    );

    return found ? { ...found.data } : null;
  }

  async pushItem(
    workspaceId: string,
    collectionId: string,
    targetForeignKey: string | number,
    data: Record<string, unknown>
  ): Promise<PersistenceItem> {
    const newItem: PersistenceItem = {
      id: `item_${this.idCounter++}`,
      workspaceId,
      collectionId,
      targetForeignKey,
      data: { ...data },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.items.push(newItem);
    return newItem;
  }

  async setScalar(
    workspaceId: string,
    collectionId: string,
    targetForeignKey: string | number,
    data: Record<string, unknown>
  ): Promise<PersistenceItem> {
    const existingIndex = this.items.findIndex(
      (item) =>
        item.workspaceId === workspaceId &&
        item.collectionId === collectionId &&
        String(item.targetForeignKey) === String(targetForeignKey)
    );

    if (existingIndex >= 0 && this.items[existingIndex]) {
      this.items[existingIndex].data = {
        ...this.items[existingIndex].data,
        ...data,
      };
      this.items[existingIndex].updatedAt = new Date().toISOString();
      return this.items[existingIndex];
    }

    const newItem: PersistenceItem = {
      id: `item_${this.idCounter++}`,
      workspaceId,
      collectionId,
      targetForeignKey,
      data: { ...data },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.items.push(newItem);
    return newItem;
  }

  async deleteItem(
    workspaceId: string,
    collectionId: string,
    itemId: string | number
  ): Promise<void> {
    this.items = this.items.filter(
      (item) =>
        !(
          item.workspaceId === workspaceId &&
          item.collectionId === collectionId &&
          String(item.id) === String(itemId)
        )
    );
  }

  async clear(workspaceId?: string): Promise<void> {
    if (workspaceId) {
      this.items = this.items.filter((item) => item.workspaceId !== workspaceId);
    } else {
      this.items = [];
    }
  }
}
