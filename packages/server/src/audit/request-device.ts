import { AsyncLocalStorage } from "node:async_hooks";

/** Dispositivo da sessão que faz a requisição em andamento; o Audit Log o grava em cada entrada. */
export interface RequestDevice {
  id: string;
  name: string;
}

const storage = new AsyncLocalStorage<RequestDevice | undefined>();

/** Executa `fn` com o Dispositivo da requisição; sem Dispositivo, as entradas ficam sem ele. */
export const runWithDevice = <T>(device: RequestDevice | undefined, fn: () => T): T => storage.run(device, fn);

export const currentDevice = (): RequestDevice | undefined => storage.getStore();
