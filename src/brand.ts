/**
 * Brand marking a value produced by `useCombinedQueries`. It lets the hook tell a *nested*
 * combined result apart from a leaf `useQuery()` result among its members, so it can recurse
 * into it (read the nested keyed `data`/`errors`/`status`, and unwrap its `refetch`).
 *
 * It's a `unique symbol`, so the key can't collide with anything and never shows up in
 * `Object.keys`. You don't construct or read this yourself — the hook stamps it on its output.
 */
export const COMBINED_BRAND: unique symbol = Symbol(
  "useCombinedQueries.combined",
);
export type CombinedBrand = typeof COMBINED_BRAND;
