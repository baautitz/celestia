import { lazy, type ComponentType } from "react";

/** Carrega uma tela sob demanda (code-splitting): o chunk só é baixado quando a rota é aberta. Páginas usam export nomeado. */
export const lazyPage = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K): ComponentType =>
  lazy<ComponentType>(async () => ({ default: (await load())[name] }));
