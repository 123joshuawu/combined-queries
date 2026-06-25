# use-combined-queries

**Combine multiple `@tanstack/react-query` queries into one "combined" query result.**

`useCombinedQueries` takes a record of `useQuery()` results you've already created, keyed by names you
choose, and returns a single combined result: aggregated loading/error flags, a keyed `data` object,
keyed `errors`, and a `refetch` that can be scoped to specific keys.

```ts
// Each hook is a plain useQuery() call — different options, different shapes.
const useCurrentUser = () => {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: fetchCurrentUser,
    refetchInterval: 30_000,             // re-poll every 30 s
  })
}

const useUserPosts = (userId?: string) => {
  return useQuery({
    queryKey: ['posts', userId],
    queryFn: () => fetchPosts(userId!),
    enabled: !!userId,
    select: (posts) => posts.sort((a, b) => b.createdAt - a.createdAt),
    staleTime: 60_000,
  })
}

// Combine them — no refactor needed, just pass the results in.
const ProfilePage = ({ userId }: { userId: string }) => {
  const currentUser = useCurrentUser()
  const userPosts = useUserPosts(userId)

  const combined = useCombinedQueries({ currentUser, userPosts })

  combined.isLoading                                    // true while either query loads
  const { currentUser: user, userPosts: posts } = combined.data   // each is `T | undefined`
  combined.refetch({ keys: ['currentUser'] })           // refetch only currentUser
}
```

---

## Why this exists

React Query already combines multiple queries via `useQueries({ queries, combine })` — but that hook
takes an array of query **options**, returns positional results, and has no built-in way to refetch a
single member. In practice you often already have named `useQuery()` calls and just want to treat them
as one unit: "are *any* of these loading?", "give me *all* their data under the keys I named", "refetch
*just this one*".

`useCombinedQueries` is that small ergonomic layer. You keep writing ordinary `useQuery()` calls; the
hook composes their results.

It also **composes with itself**: a member of the input record may be another `useCombinedQueries()`
result, so reusable "feature" hooks can be combined into bigger units (see [Composition](#composition)).

### It preserves React Query's selective-subscription optimization

Each `useQuery()` return is a **tracking proxy**: React Query records which properties you read and only
re-renders the component when one of *those* properties changes (`QueryObserver.trackResult` /
`shouldNotifyListeners` in query-core). A naive "combine" helper that eagerly reads every field of every
query to build its output would mark *everything* as tracked and defeat that optimization.

`useCombinedQueries` instead exposes its combined fields as **lazy getters**. `combined.isLoading` reads
each underlying `query.isLoading` only when you access it; `combined.data` reads each `query.data` only
when you access it. So reading just `combined.isLoading` subscribes the component to only the `isLoading`
of each member — the same selective subscription you'd get from the individual queries.

---

## API

```ts
import type { UseQueryResult } from '@tanstack/react-query'

// A member is a leaf useQuery() result OR another combined result (see Composition).
type LeafQuery = UseQueryResult<unknown, unknown>
type CombinableMember = LeafQuery | CombinedQueryResult<any>

// Input: a record of members, keyed by names you choose.
type QueryRecord = Record<string, CombinableMember>

// Per-key data, preserving the key map and recursing into nested combined members.
// A leaf is `D | undefined` (undefined until it succeeds); a nested member is its keyed data.
type CombinedData<T extends QueryRecord> = {
  [K in keyof T]: T[K] extends CombinedQueryResult<infer U>
    ? CombinedData<U>
    : T[K] extends UseQueryResult<infer D, any> ? D | undefined : never
}

// Per-key error type; only populated for members currently in error. A nested member's
// slot is its own keyed errors object.
type CombinedErrors<T extends QueryRecord> = {
  [K in keyof T]?: T[K] extends CombinedQueryResult<infer U>
    ? CombinedErrors<U>
    : T[K] extends UseQueryResult<any, infer E> ? E : never
}

// Per-key status: a leaf's 'pending' | 'error' | 'success', or a nested status object.
type CombinedStatus<T extends QueryRecord> = {
  [K in keyof T]: T[K] extends CombinedQueryResult<infer U>
    ? CombinedStatus<U>
    : 'pending' | 'error' | 'success'
}

// What refetch resolves to: the keyed data of the refetched members (recursively partial).
type RefetchResult<T extends QueryRecord> = {
  [K in keyof T]?: T[K] extends CombinedQueryResult<infer U>
    ? RefetchResult<U>
    : T[K] extends UseQueryResult<infer D, any> ? D | undefined : never
}

interface RefetchInput<T extends QueryRecord> {
  // Omit (or pass an empty array) to refetch all members; otherwise only the listed keys.
  keys?: ReadonlyArray<keyof T>
}

interface CombinedQueryResult<T extends QueryRecord> {
  readonly [COMBINED_BRAND]: true  // internal: marks this as nestable (see Composition)

  // Keyed aggregations (referentially stable while unchanged)
  data: CombinedData<T>          // keyed; leaf is `undefined` until it succeeds, nested is keyed data
  errors: CombinedErrors<T>      // keyed; entry present only while that member is in error
  status: CombinedStatus<T>      // keyed status; nested members nest

  // Aggregated boolean flags (ANY unless noted)
  isPending: boolean             // some(m => m.isPending)
  isLoading: boolean             // some(m => m.isLoading)
  isFetching: boolean            // some(m => m.isFetching)
  isError: boolean               // some(m => m.isError)
  isSuccess: boolean             // every(m => m.isSuccess)

  // Pass-through & modified
  queries: T                                            // pass-through to the individual members
  refetch: (input?: RefetchInput<T>) => Promise<RefetchResult<T>>
}

// `NonEmpty<T>` makes the record require at least one member — `useCombinedQueries({})` is a type error.
declare function useCombinedQueries<T extends QueryRecord>(
  queries: T & NonEmpty<T>,
): CombinedQueryResult<T>
```

This is a deliberately **curated** surface. If you need a per-query field that isn't aggregated here
(`dataUpdatedAt`, `failureReason`, `fetchStatus`, `isStale`, …), read it off `combined.queries.<key>` —
the untouched `UseQueryResult` is passed through unchanged.

### Generics

The single type parameter `T` is the input record, so the output is fully inferred from the queries you
pass — no manual annotation:

```ts
const combined = useCombinedQueries({
  user: useQuery<User>(/* ... */),
  posts: useQuery<Post[]>(/* ... */),
})

combined.data.user    // User | undefined
combined.data.posts   // Post[] | undefined
combined.refetch({ keys: ['user'] })   // ✅
combined.refetch({ keys: ['nope'] })   // ✗ type error — not a key of T
```

---

## Combine semantics

Aggregation mirrors React Query's own mechanics, so `useCombinedQueries({ a })` is observationally equal
to `a` — the single-query case is the identity.

| Field | Rule |
|---|---|
| `data` | Keyed object `{ [key]: query.data }`; each value is `undefined` until that query succeeds |
| `status` | Keyed object `{ [key]: query.status }` — the per-query `'pending' \| 'error' \| 'success'` |
| `errors` | Keyed object; an entry exists only while that query `isError` |
| `isPending` | `true` if **any** query is pending |
| `isLoading` | `true` if **any** query is loading |
| `isFetching` | `true` if **any** query is fetching |
| `isError` | `true` if **any** query is in error |
| `isSuccess` | `true` only if **every** query is successful |

`refetch()` with no argument refetches every query; `refetch({ keys: ['a', 'b'] })` refetches only the
named members. It resolves, once those settle, to the keyed `data` of just the refetched members
(`Partial<CombinedData<T>>`).

### Referential stability

`combined.data`, `combined.errors`, and `combined.status` keep the **same object identity** across renders
while their contents are unchanged, so they're safe as `useEffect`/`useMemo` dependencies. Each is run
through query-core's `replaceEqualDeep` against the previous value: deeply-equal renders return the prior
reference, and partial changes return a new object that still shares the references of unchanged members.
This comparison happens lazily *inside the getter*, so it only reads (and only subscribes to) the field
for components that actually access it — it does not defeat the selective-subscription optimization above.

---

## Composition

A member of the input record may itself be a `useCombinedQueries()` result. This lets you build
reusable **feature hooks** out of queries and then combine those features, with the grouping preserved.

```ts
// A reusable feature hook that returns a combined result.
function useUserInfo() {
  const profile = useQuery({ queryKey: ['profile'], queryFn: fetchProfile })
  const auth = useQuery({ queryKey: ['auth'], queryFn: fetchAuth })
  return useCombinedQueries({ profile, auth })
}

// A page that needs user info AND tables — drop the feature hook straight in.
function Page() {
  const userInfo = useUserInfo()                  // CombinedQueryResult
  const tables = useQuery({ queryKey: ['tables'], queryFn: fetchTables })
  const combined = useCombinedQueries({ userInfo, tables })

  combined.isLoading                  // folds across the whole tree (any leaf loading)
  combined.data.userInfo.profile      // nested — grouping preserved
  combined.data.tables                // leaf — `Table[] | undefined`
  combined.refetch({ keys: ['userInfo'] })  // re-runs the whole user-info unit
}
```

How a nested combined member behaves:

| Field | Behavior |
|---|---|
| `data` | Nests: `data.userInfo` is the member's own keyed data object (`{ profile, auth }`). |
| `status` | Nests: `status.userInfo` is the member's keyed status object; leaves stay a string. |
| `errors` | Nests: while the nested unit is in error, `errors.userInfo` is its keyed `errors` (with real values). |
| `isPending` / `isLoading` / `isFetching` / `isError` / `isSuccess` | Fold transparently — a nested member already exposes these booleans, so the parent's ANY/ALL aggregation includes its whole subtree. |
| `refetch({ keys: ['userInfo'] })` | Re-runs **every** query inside the nested unit (not the siblings), and resolves to `{ userInfo: { profile, auth } }`. |

A combined result is tagged with an internal `COMBINED_BRAND` symbol; that's how the hook tells a nested
combined member apart from a leaf `UseQueryResult` and recurses into it. You don't read or set it yourself.

> **Flatten instead, if you don't want the extra nesting level.** If you'd rather have one flat namespace
> (`combined.data.profile` rather than `combined.data.userInfo.profile`), have the feature hook export its
> raw query record and spread it: `useCombinedQueries({ ...useUserInfoQueries(), tables })`. Composition is
> for when you want to *keep* the grouping boundary.

---

## React Query version support

Works with **`@tanstack/react-query` `^4.0.0 || ^5.0.0`** from a single build — it's the declared
peer range. The combined result always speaks **v5 vocabulary** (`isPending`, `status: 'pending'`)
regardless of which major you installed, so your consuming code reads the same on either.

This works because the hook only ever *reads* a query result structurally — it never constructs
`useQuery` options or touches a `QueryClient` — and it normalizes the two fields that changed
meaning between v4 and v5:

| Combined field | react-query v5 source | react-query v4 source |
| --- | --- | --- |
| `isPending` | `isPending` | `status === 'loading'` |
| `isLoading` | `isLoading` (= "no data yet *and* fetching") | `isInitialLoading` |
| `status` | `status` (`'pending' \| …`) | `status` with `'loading'` → `'pending'` |
| `data` / `error` / `isFetching` / `isError` / `isSuccess` | identical | identical |

The runtime dependency on react-query's `replaceEqualDeep` is removed by vendoring it (it's
identical across majors but ships from `query-core`, whose major tracks react-query's). See
`src/memberAccess.ts`. v3 (the `react-query` package) is **not** supported.

## Gotchas

- **A disabled member keeps the combined result pending — by design, not as a wart.** This is just React
  Query's own behavior surfaced: a query with `enabled: false` and no data is `status: 'pending'` /
  `isSuccess: false` *as a single query too*. Because aggregation is faithful (`isPending` is ANY,
  `isSuccess` is ALL), `combined.isPending` stays `true` and `combined.isSuccess` stays `false` while any
  member is disabled-and-dataless — exactly what that member reports on its own. For *dependent* queries
  (`enabled: !!dep.data`) this is what you want: the group reads "still loading" until the dependent
  resolves. If you need to ignore a specific disabled member, inspect it via per-key `combined.status` /
  `combined.queries.<key>`.
- **At least one query is required.** `useCombinedQueries({})` is a type error (the parameter rejects an
  empty record). If an empty record is reached anyway via a cast or from JavaScript, the hook logs a
  `console.error` rather than throwing — so a stray empty record can't crash a render. An empty record has
  no meaning and no underlying single-query to mirror, so it's disallowed rather than given a vacuous
  "success" answer.
- **`refetch` passes through to React Query.** Refetching a member with `enabled: false` still runs its
  query function (this matches `query.refetch()`'s own behavior).
- **Inputs must be `UseQueryResult`s or other combined results.** Results from `useInfiniteQuery` or
  `useSuspenseQuery` have a different shape and aren't supported. A nested `useCombinedQueries()` result
  *is* supported (see [Composition](#composition)) — it's recognized by its `COMBINED_BRAND`.

---

## Getting started with development

```bash
pnpm install
pnpm test        # vitest (jsdom)
pnpm typecheck   # tsc, incl. type-level tests
pnpm build       # emit dist/ with .d.ts
pnpm lint        # eslint
```
