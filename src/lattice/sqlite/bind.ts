/** Bun sqlite named parameters require `$`-prefixed object keys. */
export type BunBind<T extends Record<string, unknown>> = {
  [K in keyof T as `$${Extract<K, string>}`]: T[K];
};

export function bind<T extends Record<string, unknown>>(params: T): BunBind<T> {
  const result = {} as Record<string, unknown>;
  for (const key of Object.keys(params)) {
    result[`$${key}`] = params[key];
  }
  return result as BunBind<T>;
}
