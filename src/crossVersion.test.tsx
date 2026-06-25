import { describe, it, expect } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import * as rq4 from "rq4";
import * as rq5 from "rq5";
import { useCombinedQueries } from "./useCombinedQueries";
import type { CombinedQueryResult, LeafQuery } from "./types";

/**
 * Runs the version-revealing scenarios against **real** react-query v4 *and* v5 in a single
 * `vitest` invocation. Both majors are installed under aliases (`rq4`/`rq5`, see package.json),
 * so this proves the runtime normalization in `memberAccess.ts` against genuine v4 and v5
 * results — not hand-built shapes — without swapping the installed version.
 *
 * The two modules are typed as v5 (their `useQuery`/`QueryClient` APIs coincide for what we use);
 * the v4 module is cast through `unknown`. The combined result is asserted in **v5 vocabulary**
 * throughout, which must hold on both majors.
 */
type RQModule = typeof rq5;
const MAJORS: ReadonlyArray<{ name: "v4" | "v5"; rq: RQModule }> = [
  { name: "v4", rq: rq4 as unknown as RQModule },
  { name: "v5", rq: rq5 },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe.each(MAJORS)("cross-version: react-query $name", ({ name, rq }) => {
  const { useQuery, QueryClient, QueryClientProvider } = rq;

  const renderProbe = (Probe: () => ReactNode) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  };

  it("normalizes status/flags to v5 vocabulary as queries resolve", async () => {
    const dA = deferred<{ name: string }>();
    const dB = deferred<number[]>();

    let latest!: CombinedQueryResult<{ a: LeafQuery; b: LeafQuery }>;

    function Probe() {
      const a = useQuery({
        queryKey: ["cv-a", name],
        queryFn: () => dA.promise,
      });
      const b = useQuery({
        queryKey: ["cv-b", name],
        queryFn: () => dB.promise,
      });
      latest = useCombinedQueries({ a, b });
      return <div>{`${latest.isLoading}`}</div>;
    }

    renderProbe(Probe);

    // Both pending — asserted in v5 vocabulary even on the v4 leg (v4 natively says 'loading').
    expect(latest.status).toEqual({ a: "pending", b: "pending" });
    expect(latest.isPending).toBe(true);
    expect(latest.isLoading).toBe(true);
    expect(latest.isSuccess).toBe(false);

    await act(async () => {
      dA.resolve({ name: "ada" });
    });
    await waitFor(() => expect(latest.data.a).toEqual({ name: "ada" }));
    expect(latest.isLoading).toBe(true); // b still pending
    expect(latest.isSuccess).toBe(false);

    await act(async () => {
      dB.resolve([1, 2, 3]);
    });
    await waitFor(() => expect(latest.isSuccess).toBe(true));
    expect(latest.status).toEqual({ a: "success", b: "success" });
    expect(latest.isPending).toBe(false);
    expect(latest.isLoading).toBe(false);
  });

  it("a disabled member: combined is pending with isLoading false — against a real result", async () => {
    let latest!: CombinedQueryResult<{ a: LeafQuery; b: LeafQuery }>;
    let rawB!: LeafQuery;

    function Probe() {
      const a = useQuery({
        queryKey: ["cv-on", name],
        queryFn: () => Promise.resolve(1),
      });
      const b = useQuery({
        queryKey: ["cv-off", name],
        queryFn: () => Promise.resolve(2),
        enabled: false,
      });
      rawB = b;
      latest = useCombinedQueries({ a, b });
      return <div>{`${latest.isPending}`}</div>;
    }

    renderProbe(Probe);
    await waitFor(() => expect(latest.status.a).toBe("success"));

    // Sanity: we are really on the expected major (v5 carries isPending; v4 does not).
    expect("isPending" in rawB).toBe(name === "v5");
    // On v4 the *raw* disabled member natively reports isLoading:true / status:'loading' —
    // the very thing normalization fixes. The combined result reports the v5 value on both.
    if (name === "v4") {
      expect(rawB.isLoading).toBe(true);
      expect(rawB.status).toBe("loading");
    }

    expect(latest.status.b).toBe("pending");
    expect(latest.isPending).toBe(true);
    expect(latest.isLoading).toBe(false);
    expect(latest.isSuccess).toBe(false);
    expect(latest.data.b).toBeUndefined();
  });

  it("surfaces a member error keyed, on both majors", async () => {
    const boom = new Error("boom");
    let latest!: CombinedQueryResult<{ ok: LeafQuery; bad: LeafQuery }>;

    function Probe() {
      const ok = useQuery({
        queryKey: ["cv-ok", name],
        queryFn: () => Promise.resolve("fine"),
      });
      const bad = useQuery({
        queryKey: ["cv-bad", name],
        queryFn: () => Promise.reject(boom),
      });
      latest = useCombinedQueries({ ok, bad });
      return <div>{`${latest.isError}`}</div>;
    }

    renderProbe(Probe);
    await waitFor(() => expect(latest.isError).toBe(true));
    expect(latest.status.bad).toBe("error");
    expect(latest.errors).toEqual({ bad: boom });
    expect(latest.errors.ok).toBeUndefined();
  });
});
