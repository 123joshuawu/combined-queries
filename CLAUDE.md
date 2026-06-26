# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`use-combined-queries` is a single-hook React library. `useCombinedQueries` takes a keyed record of
already-created `@tanstack/react-query` `useQuery()` results (or other combined results) and returns one
combined result: aggregated boolean flags, keyed `data`/`errors`/`status`, and a scoped `refetch`. It
creates no observers, subscriptions, or `QueryClient` access of its own — it only *reads* the results
passed in. See `README.md` for the full public API and semantics.

## Commands

```bash
pnpm install
pnpm test                 # vitest run (jsdom)
pnpm test:watch           # vitest watch
pnpm vitest run src/useCombinedQueries.test.tsx   # single test file
pnpm typecheck            # tsc -p tsconfig.test.json — includes the type-level tests (*.test-d.ts)
pnpm build                # tsc -p tsconfig.json — emits dist/ with .d.ts
pnpm lint                 # eslint
pnpm format               # prettier --write src
```

Node `>=24.16.0` and pnpm (`packageManager` pins the exact version) are required.

## Two invariants that drive the whole design

Almost every nonobvious choice in `src/` exists to protect one of these. Preserve them in any change.

**1. Selective-subscription must survive the combine.** Each `UseQueryResult` from react-query is a
tracking proxy: it records which properties you *read* and re-renders only when one of those changes.
A combine helper that eagerly read every field of every member would mark everything as tracked and
defeat that optimization. So all combined fields are exposed as **lazy getters** on the returned object
(see `useCombinedQueries.ts`): `combined.isLoading` reads only each member's `isLoading`; `combined.data`
reads only each member's `data`. Never eagerly read member fields up front (e.g. don't destructure or
spread a member, don't pre-compute all fields before returning). The referential-stability comparison
(`replaceEqualDeep`) also runs *inside* each getter for the same reason.

**2. One source must behave identically on react-query v4 and v5.** The library ships a single build for
the peer range `^4 || ^5` and always speaks **v5 vocabulary** (`isPending`, `status: 'pending'`).
`isPending`/`isLoading`/`status` changed meaning between the majors; `memberAccess.ts` normalizes a leaf
result to v5 per-field. Each helper reads only the one source field it needs (to keep invariant #1), and
version detection uses the `in` operator (a `has` trap react-query's proxy does *not* record as a read).
If you read a new field off a leaf, check whether it differs across majors and route it through a
`memberAccess` helper if so.

## Architecture

- `src/useCombinedQueries.ts` — the hook. Builds the combined object of lazy getters; handles aggregation
  (boolean flags are ANY over members, except `isSuccess` which is ALL) and scoped `refetch`.
- `src/memberAccess.ts` — per-field v4→v5 normalization for **leaf** results (invariant #2).
- `src/brand.ts` — `COMBINED_BRAND`, a `unique symbol` stamped on every result. This is how the hook
  distinguishes a *nested* combined member (recurse into its keyed fields / unwrap its `refetch`) from a
  leaf `UseQueryResult`. Only leaves get normalized; nested members already speak v5. `isCombined()` in
  the hook does this check.
- `src/replaceEqualDeep.ts` — vendored from query-core to give keyed objects (`data`/`errors`/`status`)
  stable identity across renders without a runtime dependency on query-core (whose major tracks
  react-query's). Don't reintroduce that dependency.
- `src/types.ts` — the type-level machinery. `T` (the input record) is the single generic; everything
  about the output is inferred from it, including recursion into nested combined members. `NonEmpty<T>`
  makes `useCombinedQueries({})` a type error.

Composition is a core feature: a member of the input record may itself be a combined result, and the
keyed `data`/`errors`/`status` nest while boolean flags fold across the whole tree. Most branching in the
hook (`isCombined ? … : …`) is leaf-vs-nested handling — keep both paths correct when editing.

## Testing

Tests live next to source (`*.test.tsx` runtime, `*.test-d.ts` type-level). Type-level tests run under
`pnpm typecheck`, not `pnpm test`.

`src/crossVersion.test.tsx` is load-bearing: **both** react-query majors are installed under aliases
`rq4`/`rq5` (see `devDependencies` in `package.json`) and the version-revealing scenarios run against the
real v4 and v5 packages in one vitest run, asserting v5 vocabulary on both. CI (`.github/workflows/ci.yml`)
additionally pins the floor and latest of each major (`4.0.5`, `^4`, `5.0.0`, `^5`) and runs lint +
typecheck + test against each. When touching cross-version behavior, the matrix is the real gate.
