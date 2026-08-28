/** `parseQuery` yields arrays (`c.req.queries()`); list handlers take the first value of each key. */
export function firstQuery<T>(values: readonly T[] | undefined): T | undefined {
  return values?.[0];
}
