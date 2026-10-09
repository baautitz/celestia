import type { WorkspaceRecord } from "@platform/shared";

/** Persistência das Áreas de Trabalho. O servidor mantém um cache em memória e grava aqui a cada mudança. */
export interface WorkspaceStore {
  list(): Promise<WorkspaceRecord[]>;
  save(workspace: WorkspaceRecord): Promise<void>;
  remove(id: string): Promise<void>;
}
