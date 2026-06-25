import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCombinedQueries } from "./useCombinedQueries";
import type { CombinedQueryResult } from "./types";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useCombinedQueries", () => {
  it("aggregates flags (ANY for pending/loading/fetching/error, ALL for success) and keys data as queries resolve", async () => {
    const client = makeClient();
    const dA = deferred<{ name: string }>();
    const dB = deferred<number[]>();

    let latest!: CombinedQueryResult<{
      a: UseQueryResult<{ name: string }, Error>;
      b: UseQueryResult<number[], Error>;
    }>;

    function Probe() {
      const a = useQuery({ queryKey: ["a"], queryFn: () => dA.promise });
      const b = useQuery({ queryKey: ["b"], queryFn: () => dB.promise });
      latest = useCombinedQueries({ a, b });
      // touch fields so the component subscribes (mirrors real usage)
      return <div>{`${latest.isLoading}:${latest.isSuccess}`}</div>;
    }

    render(<Probe />, { wrapper: wrapper(client) });

    // Both pending.
    expect(latest.isPending).toBe(true);
    expect(latest.isLoading).toBe(true);
    expect(latest.isFetching).toBe(true);
    expect(latest.isSuccess).toBe(false);
    expect(latest.isError).toBe(false);
    expect(latest.data).toEqual({ a: undefined, b: undefined });
    expect(latest.errors).toEqual({});

    // Resolve only a — still loading overall, not yet all-success.
    await act(async () => {
      dA.resolve({ name: "ada" });
    });
    await waitFor(() => expect(latest.data.a).toEqual({ name: "ada" }));
    expect(latest.isLoading).toBe(true);
    expect(latest.isSuccess).toBe(false);
    expect(latest.data).toEqual({ a: { name: "ada" }, b: undefined });

    // Resolve b — everything settled.
    await act(async () => {
      dB.resolve([1, 2, 3]);
    });
    await waitFor(() => expect(latest.isSuccess).toBe(true));
    expect(latest.isLoading).toBe(false);
    expect(latest.isFetching).toBe(false);
    expect(latest.isPending).toBe(false);
    expect(latest.data).toEqual({ a: { name: "ada" }, b: [1, 2, 3] });
    expect(latest.errors).toEqual({});
    expect(latest.status).toEqual({ a: "success", b: "success" });
  });

  it("populates errors only for queries currently in error", async () => {
    const client = makeClient();
    const boom = new Error("boom");

    let latest!: CombinedQueryResult<{
      ok: UseQueryResult<string, Error>;
      bad: UseQueryResult<string, Error>;
    }>;

    function Probe() {
      const ok = useQuery({
        queryKey: ["ok"],
        queryFn: () => Promise.resolve("fine"),
      });
      const bad = useQuery({
        queryKey: ["bad"],
        queryFn: () => Promise.reject(boom),
      });
      latest = useCombinedQueries({ ok, bad });
      return <div>{`${latest.isError}`}</div>;
    }

    render(<Probe />, { wrapper: wrapper(client) });

    await waitFor(() => expect(latest.isError).toBe(true));
    expect(latest.isSuccess).toBe(false);
    expect(latest.errors).toEqual({ bad: boom });
    expect(latest.errors).not.toHaveProperty("ok");
    await waitFor(() => expect(latest.data.ok).toBe("fine"));

    // Keyed status reflects each member.
    expect(latest.status).toEqual({ ok: "success", bad: "error" });
  });

  it("refetch({ keys: [key] }) refetches only the named member and resolves to its data", async () => {
    const client = makeClient();
    const queryFnA = vi.fn(() => Promise.resolve("a"));
    const queryFnB = vi.fn(() => Promise.resolve("b"));

    let latest!: CombinedQueryResult<{
      a: UseQueryResult<string, Error>;
      b: UseQueryResult<string, Error>;
    }>;

    function Probe() {
      const a = useQuery({ queryKey: ["a"], queryFn: queryFnA });
      const b = useQuery({ queryKey: ["b"], queryFn: queryFnB });
      latest = useCombinedQueries({ a, b });
      return <div>{`${latest.isSuccess}`}</div>;
    }

    render(<Probe />, { wrapper: wrapper(client) });
    await waitFor(() => expect(latest.isSuccess).toBe(true));
    expect(queryFnA).toHaveBeenCalledTimes(1);
    expect(queryFnB).toHaveBeenCalledTimes(1);

    await act(async () => {
      const result = await latest.refetch({ keys: ["a"] });
      // Resolves to the keyed data of just the refetched members.
      expect(result).toEqual({ a: "a" });
    });
    expect(queryFnA).toHaveBeenCalledTimes(2);
    expect(queryFnB).toHaveBeenCalledTimes(1);

    // No argument refetches everything and resolves to all members' data.
    await act(async () => {
      const result = await latest.refetch();
      expect(result).toEqual({ a: "a", b: "b" });
    });
    expect(queryFnA).toHaveBeenCalledTimes(3);
    expect(queryFnB).toHaveBeenCalledTimes(2);

    // Empty array also refetches everything (per README).
    await act(async () => {
      await latest.refetch({ keys: [] });
    });
    expect(queryFnA).toHaveBeenCalledTimes(4);
    expect(queryFnB).toHaveBeenCalledTimes(3);
  });

  it("does NOT re-render a component that reads only isLoading when an unread member’s data changes (tracking guarantee)", async () => {
    const client = makeClient();
    let renderCount = 0;

    function TrackProbe() {
      renderCount += 1;
      const a = useQuery({
        queryKey: ["ta"],
        queryFn: () => Promise.resolve(1),
      });
      const b = useQuery({
        queryKey: ["tb"],
        queryFn: () => Promise.resolve(2),
      });
      const combined = useCombinedQueries({ a, b });
      // Read ONLY isLoading — never data.
      return <div>loading:{String(combined.isLoading)}</div>;
    }

    render(<TrackProbe />, { wrapper: wrapper(client) });
    await waitFor(() => screen.getByText("loading:false"));

    const settledRenderCount = renderCount;

    // Change an unread member's data directly in the cache.
    await act(async () => {
      client.setQueryData(["tb"], 999);
    });

    // Give React a chance to (incorrectly) re-render.
    await act(async () => {
      await Promise.resolve();
    });

    expect(renderCount).toBe(settledRenderCount);
    // Sanity: the cache really did change.
    expect(client.getQueryData(["tb"])).toBe(999);
  });

  it("warns (without throwing) when called with an empty record (no members)", () => {
    const client = makeClient();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    function Probe() {
      // @ts-expect-error an empty record is rejected at the type level too
      useCombinedQueries({});
      return null;
    }

    expect(() => render(<Probe />, { wrapper: wrapper(client) })).not.toThrow();
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/at least one query/),
    );
    spy.mockRestore();
  });

  it("keeps data and errors referentially stable across renders while their values are unchanged", async () => {
    const client = makeClient();
    const queryFnA = vi.fn(() => Promise.resolve({ n: 1 }));
    const queryFnB = vi.fn(() => Promise.resolve([1, 2]));

    let latest!: CombinedQueryResult<{
      a: UseQueryResult<{ n: number }, Error>;
      b: UseQueryResult<number[], Error>;
    }>;

    function Probe() {
      const a = useQuery({ queryKey: ["a"], queryFn: queryFnA });
      const b = useQuery({ queryKey: ["b"], queryFn: queryFnB });
      latest = useCombinedQueries({ a, b });
      // Read data + errors so the component subscribes and the getters run.
      return (
        <div>{`${Object.keys(latest.data).length}:${Object.keys(latest.errors).length}`}</div>
      );
    }

    render(<Probe />, { wrapper: wrapper(client) });
    await waitFor(() => expect(latest.isSuccess).toBe(true));

    const data1 = latest.data;
    const errors1 = latest.errors;
    const bValue = latest.data.b;

    // Refetch all; the query fns return deeply-equal (but freshly-allocated) values.
    await act(async () => {
      await latest.refetch();
    });
    await waitFor(() => expect(queryFnA).toHaveBeenCalledTimes(2));

    // Unchanged contents → same references preserved.
    expect(latest.data).toBe(data1);
    expect(latest.errors).toBe(errors1);

    // Changing one member yields a new data object, but the untouched member keeps its reference.
    await act(async () => {
      client.setQueryData(["a"], { n: 2 });
    });
    await waitFor(() => expect(latest.data.a).toEqual({ n: 2 }));
    expect(latest.data).not.toBe(data1);
    expect(latest.data.b).toBe(bValue);
  });

  it("aggregates faithfully: a disabled (dataless) member keeps the combined pending, matching RQ", async () => {
    const client = makeClient();

    let latest!: CombinedQueryResult<{
      a: UseQueryResult<number, Error>;
      b: UseQueryResult<number, Error>;
    }>;

    function Probe() {
      const a = useQuery({
        queryKey: ["a"],
        queryFn: () => Promise.resolve(1),
      });
      const b = useQuery({
        queryKey: ["b"],
        queryFn: () => Promise.resolve(2),
        enabled: false,
      });
      latest = useCombinedQueries({ a, b });
      return <div>{`${latest.isPending}`}</div>;
    }

    render(<Probe />, { wrapper: wrapper(client) });
    await waitFor(() => expect(latest.status.a).toBe("success"));

    // `b` is disabled and dataless → pending in RQ, so the combined result is pending too
    // (ANY) and not all-success (ALL). This mirrors what `b` itself reports. The status/flag
    // values are asserted in v5 vocabulary; they hold identically on react-query v4 and v5
    // because the hook normalizes (`'loading'` → `'pending'`, etc.). See `memberAccess.ts`.
    expect(latest.status.b).toBe("pending");
    expect(latest.isPending).toBe(true);
    // `isLoading` is the field whose *meaning* differs across majors: a disabled member is not
    // fetching, so combined `isLoading` is false on both v4 and v5 once normalized.
    expect(latest.isLoading).toBe(false);
    expect(latest.isSuccess).toBe(false);
    expect(latest.data.b).toBeUndefined();
  });

  it("is the identity for a single query: useCombinedQueries({ a }) mirrors a (even when disabled)", () => {
    const client = makeClient();

    let normalized = false;
    let identityOnV5 = false;

    function Probe() {
      const a = useQuery({
        queryKey: ["solo"],
        queryFn: () => Promise.resolve(1),
        enabled: false,
      });
      const combined = useCombinedQueries({ a });

      // Normalized (v5-vocabulary) invariants for a single disabled query — these hold
      // identically whether the consumer installed react-query v4 or v5.
      normalized =
        combined.isPending === true &&
        combined.isLoading === false &&
        combined.isFetching === false &&
        combined.isError === false &&
        combined.isSuccess === false &&
        combined.status.a === "pending" &&
        combined.data.a === undefined;

      // On v5 the combined result is *literally* identical to the raw member (no vocabulary
      // gap). On v4 the hook intentionally normalizes, so identity-with-raw is v5-only.
      const isV5 = "isPending" in a;
      identityOnV5 =
        !isV5 ||
        (combined.isPending === a.isPending &&
          combined.isLoading === a.isLoading &&
          combined.isFetching === a.isFetching &&
          combined.isError === a.isError &&
          combined.isSuccess === a.isSuccess &&
          combined.status.a === a.status &&
          combined.data.a === a.data);

      return null;
    }

    render(<Probe />, { wrapper: wrapper(client) });

    expect(normalized).toBe(true);
    expect(identityOnV5).toBe(true);
  });
});

describe("useCombinedQueries composition (a combined result as a member)", () => {
  it("nests data/status, folds flags, and scopes refetch — the useUserInfo + useTables case", async () => {
    const client = makeClient();
    const profileFn = vi.fn(() => Promise.resolve({ name: "ada" }));
    const authFn = vi.fn(() => Promise.resolve({ token: "t" }));
    const tablesFn = vi.fn(() => Promise.resolve([{ rows: 3 }]));

    type Profile = { name: string };
    type Auth = { token: string };
    type Table = { rows: number };

    let page!: CombinedQueryResult<{
      userInfo: CombinedQueryResult<{
        profile: UseQueryResult<Profile, Error>;
        auth: UseQueryResult<Auth, Error>;
      }>;
      tables: UseQueryResult<Table[], Error>;
    }>;

    // A reusable combined hook...
    function useUserInfo() {
      const profile = useQuery({ queryKey: ["profile"], queryFn: profileFn });
      const auth = useQuery({ queryKey: ["auth"], queryFn: authFn });
      return useCombinedQueries({ profile, auth });
    }

    function Probe() {
      const userInfo = useUserInfo();
      const tables = useQuery({ queryKey: ["tables"], queryFn: tablesFn });
      // ...dropped straight into a parent combine.
      page = useCombinedQueries({ userInfo, tables });
      return <div>{`${page.isSuccess}`}</div>;
    }

    render(<Probe />, { wrapper: wrapper(client) });
    await waitFor(() => expect(page.isSuccess).toBe(true));

    // Flags fold across the whole tree.
    expect(page.isPending).toBe(false);
    expect(page.isError).toBe(false);

    // data preserves the grouping: data.userInfo.profile, data.tables.
    expect(page.data).toEqual({
      userInfo: { profile: { name: "ada" }, auth: { token: "t" } },
      tables: [{ rows: 3 }],
    });

    // status nests: a string for the leaf, a keyed object for the nested member.
    expect(page.status).toEqual({
      userInfo: { profile: "success", auth: "success" },
      tables: "success",
    });

    // refetch scoped to the nested unit re-runs both its members, but not the sibling.
    profileFn.mockClear();
    authFn.mockClear();
    tablesFn.mockClear();
    let scoped!: Record<string, unknown>;
    await act(async () => {
      scoped = (await page.refetch({ keys: ["userInfo"] })) as Record<
        string,
        unknown
      >;
    });
    expect(profileFn).toHaveBeenCalledTimes(1);
    expect(authFn).toHaveBeenCalledTimes(1);
    expect(tablesFn).toHaveBeenCalledTimes(0);
    // ...and the nested member resolves to its own keyed data (not undefined).
    expect(scoped).toEqual({
      userInfo: { profile: { name: "ada" }, auth: { token: "t" } },
    });

    // A full refetch returns the whole nested shape.
    let all!: Record<string, unknown>;
    await act(async () => {
      all = (await page.refetch()) as Record<string, unknown>;
    });
    expect(all).toEqual({
      userInfo: { profile: { name: "ada" }, auth: { token: "t" } },
      tables: [{ rows: 3 }],
    });
  });

  it("surfaces a nested member’s real error value (not undefined) and folds isError", async () => {
    const client = makeClient();
    const boom = new Error("auth failed");

    let page!: CombinedQueryResult<{
      userInfo: CombinedQueryResult<{
        profile: UseQueryResult<string, Error>;
        auth: UseQueryResult<string, Error>;
      }>;
      tables: UseQueryResult<string, Error>;
    }>;

    function Probe() {
      const profile = useQuery({
        queryKey: ["profile"],
        queryFn: () => Promise.resolve("p"),
      });
      const auth = useQuery({
        queryKey: ["auth"],
        queryFn: () => Promise.reject(boom),
      });
      const userInfo = useCombinedQueries({ profile, auth });
      const tables = useQuery({
        queryKey: ["tables"],
        queryFn: () => Promise.resolve("t"),
      });
      page = useCombinedQueries({ userInfo, tables });
      return <div>{`${page.isError}`}</div>;
    }

    render(<Probe />, { wrapper: wrapper(client) });
    await waitFor(() => expect(page.isError).toBe(true));

    // The nested error surfaces with its real value, keyed by the nested member.
    expect(page.errors).toEqual({ userInfo: { auth: boom } });
    expect(page.errors.userInfo?.auth).toBe(boom);
    // The healthy sibling has no error entry.
    expect(page.errors).not.toHaveProperty("tables");
  });

  it("keeps nested data referentially stable across an unrelated refetch", async () => {
    const client = makeClient();
    const profileFn = vi.fn(() => Promise.resolve({ name: "ada" }));
    const tablesFn = vi.fn(() => Promise.resolve([1]));

    let page!: CombinedQueryResult<{
      userInfo: CombinedQueryResult<{
        profile: UseQueryResult<{ name: string }, Error>;
      }>;
      tables: UseQueryResult<number[], Error>;
    }>;

    function Probe() {
      const profile = useQuery({ queryKey: ["profile"], queryFn: profileFn });
      const userInfo = useCombinedQueries({ profile });
      const tables = useQuery({ queryKey: ["tables"], queryFn: tablesFn });
      page = useCombinedQueries({ userInfo, tables });
      // Read data so the getter runs and structural sharing kicks in.
      return <div>{Object.keys(page.data).length}</div>;
    }

    render(<Probe />, { wrapper: wrapper(client) });
    await waitFor(() => expect(page.isSuccess).toBe(true));

    const userInfo1 = page.data.userInfo;

    // Refetch only tables; userInfo's deeply-equal data should keep its reference.
    await act(async () => {
      await page.refetch({ keys: ["tables"] });
    });
    await waitFor(() => expect(tablesFn).toHaveBeenCalledTimes(2));

    expect(page.data.userInfo).toBe(userInfo1);
  });
});
