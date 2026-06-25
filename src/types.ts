import type { UseQueryResult } from "@tanstack/react-query";
import type { COMBINED_BRAND } from "./brand";

/** A leaf input: a single `useQuery()` result. */
export type LeafQuery = UseQueryResult<unknown, unknown>;

/**
 * A member of the input record: either a leaf `useQuery()` result, or **another
 * `useCombinedQueries()` result**. The latter is what lets reusable combined hooks compose —
 * a `useUserInfo()` that returns a combined result can be dropped straight into a parent
 * `useCombinedQueries({ userInfo: useUserInfo(), tables: useTables() })`, and the nesting is
 * preserved (`combined.data.userInfo.profile`).
 */
export type CombinableMember = LeafQuery | CombinedQueryResult<any>;

/** Input: a record of query results, keyed by names you choose. Each value is either a
 * `useQuery()` result or a nested combined result. */
export type QueryRecord = Record<string, CombinableMember>;

/**
 * Per-member `data`: a nested combined member contributes its *keyed* data object; a leaf
 * contributes `D | undefined` (`undefined` until it succeeds, mirroring React Query).
 */
export type MemberData<M> =
  M extends CombinedQueryResult<infer U>
    ? CombinedData<U>
    : M extends UseQueryResult<infer D, any>
      ? D | undefined
      : never;

/** Per-key data type, preserving the key map and recursing into nested combined members. */
export type CombinedData<T extends QueryRecord> = {
  [K in keyof T]: MemberData<T[K]>;
};

/** Per-member error: a nested combined member contributes its keyed `errors`; a leaf its `E`. */
export type MemberError<M> =
  M extends CombinedQueryResult<infer U>
    ? CombinedErrors<U>
    : M extends UseQueryResult<any, infer E>
      ? E
      : never;

/** Per-key error type; an entry is present only while that member is currently in error. */
export type CombinedErrors<T extends QueryRecord> = {
  [K in keyof T]?: MemberError<T[K]>;
};

/**
 * The status vocabulary a leaf contributes to the combined result. Pinned to v5's vocabulary
 * (`'pending' | 'error' | 'success'`) rather than derived from the installed `UseQueryResult`,
 * because the runtime normalizes v4's `'loading'` to `'pending'` — so the type stays correct
 * whether the consumer is on react-query v4 or v5. See `memberAccess.ts`.
 */
export type LeafStatus = "pending" | "error" | "success";

/** Per-member `status`: a nested member contributes its keyed status object; a leaf its string. */
export type MemberStatus<M> =
  M extends CombinedQueryResult<infer U>
    ? CombinedStatus<U>
    : M extends UseQueryResult
      ? LeafStatus
      : never;

/** Per-key `status`, recursing into nested combined members. */
export type CombinedStatus<T extends QueryRecord> = {
  [K in keyof T]: MemberStatus<T[K]>;
};

/** Per-key projection of a single `UseQueryResult` field, preserving the key map. (Leaf-only.) */
export type Keyed<
  T extends Record<string, UseQueryResult<unknown, unknown>>,
  K extends keyof UseQueryResult,
> = {
  [P in keyof T]: T[P][K];
};

/**
 * What `refetch` resolves to: the keyed data of the refetched members. It's a (recursive)
 * partial — top-level members are optional (you may have scoped to a subset), and a nested
 * member resolves to its own `RefetchResult`.
 */
export type RefetchResult<T extends QueryRecord> = {
  [K in keyof T]?: T[K] extends CombinedQueryResult<infer U>
    ? RefetchResult<U>
    : T[K] extends UseQueryResult<infer D, any>
      ? D | undefined
      : never;
};

/**
 * Compile-time guard for the hook's parameter. When `T` has no keys, the parameter gains a
 * required phantom property that an empty object literal can't satisfy — turning
 * `useCombinedQueries({})` into a type error. Non-empty records intersect with `unknown`
 * (a no-op), so inference of `T` is unaffected.
 */
export type NonEmpty<T extends QueryRecord> = keyof T extends never
  ? { __useCombinedQueries_requiresAtLeastOneQuery: never }
  : unknown;

export interface RefetchInput<T extends QueryRecord> {
  /** Omit (or pass an empty array) to refetch all members; otherwise only the listed keys. */
  keys?: ReadonlyArray<keyof T>;
}

export interface CombinedQueryResult<T extends QueryRecord> {
  /** Internal brand; marks this value as a combined result so it can be nested (see `brand.ts`). */
  readonly [COMBINED_BRAND]: true;

  // --- Keyed aggregations (like `data`) ---
  /** Keyed; a leaf is `undefined` until it succeeds, a nested member is its own keyed data. */
  data: CombinedData<T>;
  /** Keyed; entry present only while that member is in error. */
  errors: CombinedErrors<T>;
  /** Keyed per-member `status` — a string for a leaf, a nested status object for a combined member. */
  status: CombinedStatus<T>;

  // --- Aggregated boolean flags ---
  /** `true` if any member is pending. */
  isPending: boolean;
  /** `true` if any member is loading. */
  isLoading: boolean;
  /** `true` if any member is fetching. */
  isFetching: boolean;
  /** `true` if any member is in error. */
  isError: boolean;
  /** `true` only if every member is successful. */
  isSuccess: boolean;

  // --- Pass-through & modified ---
  /** Pass-through to the individual members. */
  queries: T;
  /**
   * Refetch all members, or only the named `keys`. Resolves to the keyed `data` of the
   * refetched members once they settle; a nested member resolves to its own keyed data.
   */
  refetch: (input?: RefetchInput<T>) => Promise<RefetchResult<T>>;
}
