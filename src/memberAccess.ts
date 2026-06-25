/**
 * Cross-version normalization for *leaf* `useQuery()` results.
 *
 * `useCombinedQueries` reads a handful of fields off each member. Two of them changed meaning
 * between react-query v4 and v5, so reading them naively would mean the combined result behaves
 * differently depending on which major the consumer installed:
 *
 *   - `isPending` is **v5-only**. v4's equivalent ("no data yet") is `status === 'loading'`.
 *   - `isLoading` **changed meaning**: v4 `isLoading` is "no data yet" (== v5 `isPending`);
 *     v5 `isLoading` is "no data yet *and* fetching" (== v4 `isInitialLoading`).
 *   - `status` vocabulary: v4 uses `'loading'`, v5 uses `'pending'`.
 *
 * These helpers normalize a leaf to **v5 vocabulary** so the combined result speaks one stable
 * language regardless of the installed major. They are deliberately split per-field, and each
 * reads only the *one* source field it needs, so a getter that aggregates (e.g. `isPending`)
 * subscribes the component to only that field across members — preserving react-query's
 * tracked-property optimization through the shim. (Version detection uses the `in` operator,
 * a `has` trap that react-query's tracking proxy does *not* record as a read.)
 *
 * Only leaves are normalized. A *nested* combined member is produced by this hook and already
 * exposes v5-vocabulary fields, so callers route it through directly (see `isCombined`).
 */

/** The union of leaf-result fields this library reads across react-query v4 and v5. */
export interface RawLeafResult {
  data: unknown;
  error: unknown;
  status: "pending" | "loading" | "error" | "success";
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  /** v5 only. */
  isPending?: boolean;
  /** Present in both, but with different meaning (see file header). */
  isLoading?: boolean;
  /** v4 only; the v4 equivalent of v5's `isLoading`. */
  isInitialLoading?: boolean;
  refetch: () => Promise<unknown>;
}

/** A leaf is a v5 result iff it carries `isPending` (a `has` check — not a tracked read). */
function isV5(leaf: RawLeafResult): boolean {
  return "isPending" in leaf;
}

/** v5 `isPending`: "no data yet". v4 source: `status === 'loading'`. */
export function leafPending(leaf: RawLeafResult): boolean {
  return isV5(leaf) ? leaf.isPending! : leaf.status === "loading";
}

/** v5 `isLoading`: "no data yet *and* fetching". v4 source: `isInitialLoading`. */
export function leafLoading(leaf: RawLeafResult): boolean {
  return isV5(leaf) ? leaf.isLoading! : leaf.isInitialLoading!;
}

/** v5 `status` vocabulary. v4 source: map `'loading'` → `'pending'`, else pass through. */
export function leafStatus(
  leaf: RawLeafResult,
): "pending" | "error" | "success" {
  if (isV5(leaf)) return leaf.status as "pending" | "error" | "success";
  return leaf.status === "loading"
    ? "pending"
    : (leaf.status as "error" | "success");
}
