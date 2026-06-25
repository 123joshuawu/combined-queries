import { useRef } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { replaceEqualDeep } from "./replaceEqualDeep";
import {
  leafLoading,
  leafPending,
  leafStatus,
  type RawLeafResult,
} from "./memberAccess";
import { COMBINED_BRAND } from "./brand";
import type {
  CombinedData,
  CombinedQueryResult,
  NonEmpty,
  QueryRecord,
  RefetchInput,
  RefetchResult,
} from "./types";

type AnyResult = UseQueryResult<unknown, unknown>;
type AnyCombined = CombinedQueryResult<QueryRecord>;
type AnyMember = AnyResult | AnyCombined;

/** A member is a *nested* combined result (vs. a leaf `useQuery()` result) iff it carries the brand. */
function isCombined(member: AnyMember): member is AnyCombined {
  return (member as Partial<AnyCombined>)[COMBINED_BRAND] === true;
}

/**
 * Combine a keyed record of `useQuery()` results — or other `useCombinedQueries()` results —
 * into one combined result.
 *
 * The combined fields are exposed as **lazy getters**: a field's getter reads the
 * corresponding property on each underlying result *only when accessed*. Reading
 * `combined.isLoading` therefore touches only each member's `isLoading` — subscribing
 * the component to just that prop across all members — and never touches `data`. This
 * preserves React Query's selective-subscription (tracked-property) optimization; see
 * `README.md` for the mechanism and the query-core references.
 *
 * We deliberately create no observers, subscription, or `QueryClient` access of our own:
 * re-renders are already driven by the upstream `useQuery()` calls.
 *
 * **Composition.** A member may itself be a combined result (it carries the `COMBINED_BRAND`).
 * Such a member is treated faithfully: its keyed `data`/`errors`/`status` nest under its key
 * (`combined.data.userInfo.profile`), its boolean flags fold into the aggregate, and a scoped
 * `refetch` re-runs the whole nested unit. This is what lets reusable combined hooks compose.
 *
 * Keyed object fields (`data`, `errors`, `status`) are **referentially stable** across
 * renders while their contents are unchanged: each getter runs the freshly-assembled
 * object through query-core's `replaceEqualDeep` against the previous one, returning the
 * prior reference when deeply equal (and otherwise a new object that still shares unchanged
 * members). The comparison happens *inside the getter*, so it only reads — and only
 * subscribes to — the fields a component actually accesses; it does not defeat the
 * lazy-tracking optimization above.
 */
export function useCombinedQueries<T extends QueryRecord>(
  queries: T & NonEmpty<T>,
): CombinedQueryResult<T> {
  // An empty record has no meaning (and no single query to mirror); it's rejected at the
  // type level. For JS callers / casts that bypass the types we warn rather than throw, so
  // a stray empty record can't crash a render.
  if (Object.keys(queries).length === 0) {
    console.error(
      "useCombinedQueries requires at least one query; received an empty record.",
    );
  }

  // One cache for every keyed-object getter, so each stays referentially stable
  // across renders while its contents are unchanged.
  const stableCache = useRef<Record<string, unknown>>({});

  const members = (): AnyMember[] => Object.values(queries) as AnyMember[];
  const entries = (): Array<[string, AnyMember]> =>
    Object.entries(queries) as Array<[string, AnyMember]>;

  /** Build a keyed object by projecting one field off each member, kept stable by name. */
  const keyed = <V>(name: string, pick: (query: AnyMember) => V): unknown => {
    const next = Object.fromEntries(
      entries().map(([key, query]) => [key, pick(query)]),
    );
    const merged = replaceEqualDeep(stableCache.current[name], next);
    stableCache.current[name] = merged;
    return merged;
  };

  const refetch = async (
    input?: RefetchInput<T>,
  ): Promise<RefetchResult<T>> => {
    const selected: Array<[keyof T, AnyMember]> = input?.keys?.length
      ? input.keys.map((key) => [key, queries[key] as AnyMember])
      : (entries() as Array<[keyof T, AnyMember]>);
    const refetched = await Promise.all(
      selected.map(async ([key, member]) => {
        // A nested combined member's refetch already resolves to its keyed data; a leaf's
        // resolves to a QueryObserverResult whose `.data` we unwrap.
        const data = isCombined(member)
          ? await member.refetch()
          : (await member.refetch()).data;
        return [key, data] as const;
      }),
    );
    return Object.fromEntries(refetched) as RefetchResult<T>;
  };

  return {
    [COMBINED_BRAND]: true,

    // --- Keyed aggregations ---
    // `data` and `status` read the member's own field, which is correct for both leaves and
    // nested combined members (a nested member's `data`/`status` are already keyed objects).
    get data() {
      return keyed("data", (query) => query.data) as CombinedData<T>;
    },
    get errors() {
      // A nested combined member exposes `errors` (keyed), not a single `error`; pick the
      // right one so a nested error surfaces with its real value rather than `undefined`.
      const next = Object.fromEntries(
        entries()
          .filter(([, query]) => query.isError)
          .map(([key, query]) => [
            key,
            isCombined(query) ? query.errors : (query as AnyResult).error,
          ]),
      );
      const merged = replaceEqualDeep(stableCache.current.errors, next);
      stableCache.current.errors = merged;
      return merged as CombinedQueryResult<T>["errors"];
    },
    get status() {
      // A nested combined member's `status` is already a keyed object in v5 vocabulary; a leaf
      // is normalized (v4 `'loading'` → `'pending'`) so the combined status reads identically
      // across react-query majors.
      return keyed("status", (query) =>
        isCombined(query) ? query.status : leafStatus(query as RawLeafResult),
      ) as CombinedQueryResult<T>["status"];
    },

    // --- Aggregated boolean flags (ANY unless noted) ---
    // Aggregated over *all* members so the combined result mirrors React Query's own
    // mechanics: `useCombinedQueries({ a })` is observationally equal to `a`. A nested
    // combined member already exposes these same booleans (in v5 vocabulary), so it folds in
    // transparently; a leaf is normalized to v5 vocabulary so v4 and v5 behave identically.
    get isPending() {
      return members().some((query) =>
        isCombined(query)
          ? query.isPending
          : leafPending(query as RawLeafResult),
      );
    },
    get isLoading() {
      return members().some((query) =>
        isCombined(query)
          ? query.isLoading
          : leafLoading(query as RawLeafResult),
      );
    },
    get isFetching() {
      return members().some((query) => query.isFetching);
    },
    get isError() {
      return members().some((query) => query.isError);
    },
    get isSuccess() {
      return members().every((query) => query.isSuccess);
    },

    // --- Pass-through & modified ---
    queries,
    refetch,
  };
}
