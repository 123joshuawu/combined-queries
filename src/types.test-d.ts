import { expectTypeOf } from "vitest";
import type { UseQueryResult } from "@tanstack/react-query";
import { useCombinedQueries } from "./useCombinedQueries";

interface User {
  id: number;
  name: string;
}
interface Post {
  title: string;
}

declare const userQ: UseQueryResult<User, Error>;
declare const postsQ: UseQueryResult<Post[], Error>;

const combined = useCombinedQueries({ user: userQ, posts: postsQ });

// data.<key> infers the per-query data type (the query's TData) OR undefined, preserving
// the key map — `data` is undefined until that query succeeds, mirroring React Query.
expectTypeOf(combined.data.user).toEqualTypeOf<User | undefined>();
expectTypeOf(combined.data.posts).toEqualTypeOf<Post[] | undefined>();

// errors.<key> is the per-query error type, optional (present only while in error).
expectTypeOf(combined.errors.user).toEqualTypeOf<Error | undefined>();

// queries is passed through unchanged.
expectTypeOf(combined.queries.user).toEqualTypeOf<
  UseQueryResult<User, Error>
>();

// Aggregated flags are plain booleans.
expectTypeOf(combined.isLoading).toEqualTypeOf<boolean>();
expectTypeOf(combined.isSuccess).toEqualTypeOf<boolean>();

// Keyed pass-through fields preserve the key map with the per-query field type.
expectTypeOf(combined.status.user).toEqualTypeOf<
  "pending" | "error" | "success"
>();

// refetch accepts real keys of the input record only, and resolves to the keyed data
// of the refetched members.
combined.refetch();
combined.refetch({ keys: ["user"] });
combined.refetch({ keys: ["user", "posts"] });
// @ts-expect-error 'nope' is not a key of the input record
combined.refetch({ keys: ["nope"] });

expectTypeOf(combined.refetch).returns.resolves.toEqualTypeOf<
  Partial<{ user: User | undefined; posts: Post[] | undefined }>
>();

// An empty record is rejected — at least one query is required.
// @ts-expect-error useCombinedQueries({}) is not allowed
useCombinedQueries({});

// --- Composition: a combined result can itself be a member ---

interface Table {
  rows: number;
}
declare const tablesQ: UseQueryResult<Table[], Error>;

// `combined` (from above) is a CombinedQueryResult; nest it under `userInfo`.
const page = useCombinedQueries({ userInfo: combined, tables: tablesQ });

// data nests: the grouping is preserved, leaves stay `D | undefined`.
expectTypeOf(page.data.userInfo.user).toEqualTypeOf<User | undefined>();
expectTypeOf(page.data.userInfo.posts).toEqualTypeOf<Post[] | undefined>();
expectTypeOf(page.data.tables).toEqualTypeOf<Table[] | undefined>();

// status nests too: a leaf is a string union, a nested member is its own keyed status.
expectTypeOf(page.status.tables).toEqualTypeOf<
  "pending" | "error" | "success"
>();
expectTypeOf(page.status.userInfo.user).toEqualTypeOf<
  "pending" | "error" | "success"
>();

// errors nest: a nested member's error slot is its own keyed errors object.
expectTypeOf(page.errors.tables).toEqualTypeOf<Error | undefined>();
expectTypeOf(page.errors.userInfo).toEqualTypeOf<
  { user?: Error; posts?: Error } | undefined
>();

// refetch keys are the parent keys; result nests for the combined member.
page.refetch({ keys: ["userInfo"] });
page.refetch({ keys: ["userInfo", "tables"] });
// @ts-expect-error 'user' is a key of the nested member, not of the parent record
page.refetch({ keys: ["user"] });
expectTypeOf(page.refetch).returns.resolves.toEqualTypeOf<{
  userInfo?: { user?: User | undefined; posts?: Post[] | undefined };
  tables?: Table[] | undefined;
}>();
