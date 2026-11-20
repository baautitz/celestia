/** Narrows a value that the test depends on, failing with a clear message instead of a bare `!`. */
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to be defined.`);
  return value;
}
