// owner: T1 permissions
export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(readonly permission: string, deniedMessage?: string) {
    super(deniedMessage ?? `Acesso negado: permissão "${permission}" é obrigatória.`);
    this.name = "ForbiddenError";
  }
}

export interface PermissionItem {
  key: string;
  label: string;
  description?: string;
  deniedMessage?: string;
  module: string;
}

export interface PermissionRef {
  readonly key: string;
  readonly deniedMessage?: string;
}

export type PermissionSpec = string | PermissionRef;

export type PermissionDef = string | { label: string; description?: string; deniedMessage?: string };

const keyOf = (p: PermissionSpec): string => (typeof p === "string" ? p : p.key);
const msgOf = (p: PermissionSpec): string | undefined => (typeof p === "string" ? undefined : p.deniedMessage);

export interface ModulePermissions<K extends string = string> {
  readonly moduleId: string;
  readonly items: readonly PermissionItem[];
  readonly keys: { readonly [P in K]: string };
  ref(key: K): PermissionRef;
}

export interface PermissionContext {
  user: { permissions: readonly string[] };
}

const PART = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;

export function definePermissions<const D extends Record<string, PermissionDef>>(
  moduleId: string,
  defs: D,
): ModulePermissions<Extract<keyof D, string>> {
  if (!PART.test(moduleId)) {
    throw new Error(`Módulo inválido "${moduleId}": use snake_case ou kebab-case minúsculo.`);
  }
  const items: PermissionItem[] = [];
  const keys: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [k, def] of Object.entries(defs)) {
    const parts = k.split(":");
    if (parts.length !== 2 || !parts.every((p) => PART.test(p))) {
      throw new Error(
        `Chave de permissão inválida "${k}" no módulo "${moduleId}": use o formato "<recurso>:<acao>" em minúsculo.`,
      );
    }
    const full = `${moduleId}:${k}`;
    if (seen.has(full)) throw new Error(`Permissão duplicada "${full}".`);
    seen.add(full);
    const d = typeof def === "string" ? { label: def } : def;
    items.push(Object.freeze({ key: full, label: d.label, description: d.description, deniedMessage: d.deniedMessage, module: moduleId }));
    keys[k] = full;
  }
  const refs = new Map<string, PermissionRef>(
    items.map((i) => [i.key, Object.freeze({ key: i.key, deniedMessage: i.deniedMessage })]),
  );
  const result: ModulePermissions = Object.freeze({
    moduleId,
    items: Object.freeze(items),
    keys: Object.freeze(keys),
    ref: (k: string): PermissionRef => refs.get(`${moduleId}:${k}`) as PermissionRef,
  });
  return result;
}

const hasPerm = (perms: readonly string[], key: string): boolean =>
  perms.includes("*") || perms.includes(key);

export class PermissionRegistry {
  private entries = new Map<string, () => readonly PermissionItem[]>();

  register(perms: ModulePermissions): void {
    this.registerProvider(perms.moduleId, () => perms.items);
  }

  registerProvider(moduleId: string, provider: () => readonly PermissionItem[]): void {
    if (this.entries.has(moduleId)) throw new Error(`Módulo "${moduleId}" já registrado.`);
    this.entries.set(moduleId, provider);
  }

  unregisterModule(moduleId: string): void {
    this.entries.delete(moduleId);
  }

  catalog(): { module: string; items: PermissionItem[] }[] {
    return [...this.entries].map(([module, p]) => ({ module, items: [...p()] }));
  }

  allKeys(): Set<string> {
    return new Set(this.catalog().flatMap((c) => c.items.map((i) => i.key)));
  }

  deniedMessage(key: string): string | undefined {
    for (const c of this.catalog()) {
      const item = c.items.find((i) => i.key === key);
      if (item) return item.deniedMessage;
    }
    return undefined;
  }

  has(userPermissions: readonly string[], key: string): boolean {
    return hasPerm(userPermissions, key);
  }
}

export function guarded<C extends PermissionContext, A extends unknown[], R>(
  permission: PermissionSpec,
  fn: (ctx: C, ...args: A) => R,
): (ctx: C, ...args: A) => R {
  const key = keyOf(permission);
  return (ctx, ...args) => {
    if (!hasPerm(ctx.user.permissions, key)) throw new ForbiddenError(key, msgOf(permission));
    return fn(ctx, ...args);
  };
}

export interface Variant<C extends PermissionContext, A extends unknown[], R> {
  when: PermissionSpec;
  run: (ctx: C, ...args: A) => R;
}

export function pickVariant<V extends { when: PermissionSpec }>(
  variants: readonly V[],
  userPermissions: readonly string[],
): V | undefined {
  return variants.find((v) => hasPerm(userPermissions, keyOf(v.when)));
}

export function byPermission<C extends PermissionContext, A extends unknown[], R>(
  variants: readonly Variant<C, A, R>[],
): (ctx: C, ...args: A) => R {
  return (ctx, ...args) => {
    const v = pickVariant(variants, ctx.user.permissions);
    if (!v) throw new ForbiddenError(
        variants.map((x) => keyOf(x.when)).join(" | "),
        variants.map((x) => msgOf(x.when)).find((m) => m !== undefined),
      );
    return v.run(ctx, ...args);
  };
}

export function pruneOrphans(rolePermissions: readonly string[], validKeys: ReadonlySet<string>): string[] {
  return rolePermissions.filter((k) => k === "*" || validKeys.has(k));
}
