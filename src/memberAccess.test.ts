import { describe, it, expect } from "vitest";
import {
  leafLoading,
  leafPending,
  leafStatus,
  type RawLeafResult,
} from "./memberAccess";

/**
 * Hand-built leaf results in the *exact* shapes react-query v4 and v5 produce, so we can prove
 * the normalizers map both majors to one v5-vocabulary output without needing a QueryClient.
 * The v4/v5 field combinations below mirror real react-query state for each scenario.
 */

// --- v5-shaped results (status uses 'pending'; carries isPending) ---
const v5 = {
  pending: {
    status: "pending",
    isPending: true,
    isLoading: true,
    isFetching: true,
  },
  disabled: {
    status: "pending",
    isPending: true,
    isLoading: false, // disabled → not fetching → isLoading false
    isFetching: false,
  },
  backgroundRefetch: {
    status: "success",
    isPending: false,
    isLoading: false,
    isFetching: true, // has data, refetching
  },
  success: {
    status: "success",
    isPending: false,
    isLoading: false,
    isFetching: false,
  },
  error: {
    status: "error",
    isPending: false,
    isLoading: false,
    isFetching: false,
  },
} satisfies Record<string, Partial<RawLeafResult>>;

// --- v4-shaped results (status uses 'loading'; no isPending; has isInitialLoading) ---
const v4 = {
  pending: {
    status: "loading",
    isLoading: true, // v4 isLoading == "no data yet"
    isInitialLoading: true, // v4's equivalent of v5 isLoading
    isFetching: true,
  },
  disabled: {
    status: "loading",
    isLoading: true, // v4 reports loading even when disabled+dataless
    isInitialLoading: false, // ...but not initial-loading (not fetching)
    isFetching: false,
  },
  backgroundRefetch: {
    status: "success",
    isLoading: false,
    isInitialLoading: false,
    isFetching: true,
  },
  success: {
    status: "success",
    isLoading: false,
    isInitialLoading: false,
    isFetching: false,
  },
  error: {
    status: "error",
    isLoading: false,
    isInitialLoading: false,
    isFetching: false,
  },
} satisfies Record<string, Partial<RawLeafResult>>;

const asLeaf = (partial: Partial<RawLeafResult>): RawLeafResult =>
  ({
    data: undefined,
    error: null,
    isError: false,
    isSuccess: false,
    refetch: async () => {},
    ...partial,
  }) as RawLeafResult;

// Expected, normalized (v5-vocabulary) output per scenario.
const expected = {
  pending: { pending: true, loading: true, status: "pending" },
  disabled: { pending: true, loading: false, status: "pending" },
  backgroundRefetch: { pending: false, loading: false, status: "success" },
  success: { pending: false, loading: false, status: "success" },
  error: { pending: false, loading: false, status: "error" },
} as const;

describe("memberAccess normalizers map v4 and v5 leaves to one v5 vocabulary", () => {
  for (const scenario of Object.keys(expected) as Array<
    keyof typeof expected
  >) {
    it(`'${scenario}': v4 and v5 normalize identically`, () => {
      const want = expected[scenario];
      for (const [major, shape] of [
        ["v5", v5[scenario]],
        ["v4", v4[scenario]],
      ] as const) {
        const leaf = asLeaf(shape);
        expect({
          major,
          ...{
            pending: leafPending(leaf),
            loading: leafLoading(leaf),
            status: leafStatus(leaf),
          },
        }).toEqual({ major, ...want });
      }
    });
  }
});

describe("memberAccess normalizers stay lazy (the tracked-property guard)", () => {
  /** Wrap a leaf in a read-recording proxy; `in` (has trap) is intentionally NOT recorded,
   * mirroring react-query's tracking proxy which only records `get`. */
  function recording(leaf: RawLeafResult) {
    const reads = new Set<string>();
    const proxy = new Proxy(leaf, {
      get(target, key, receiver) {
        if (typeof key === "string") reads.add(key);
        return Reflect.get(target, key, receiver);
      },
    });
    return { proxy, reads };
  }

  it("leafPending reads only isPending (v5) / only status (v4)", () => {
    const v5r = recording(asLeaf(v5.pending));
    leafPending(v5r.proxy);
    expect([...v5r.reads]).toEqual(["isPending"]);

    const v4r = recording(asLeaf(v4.pending));
    leafPending(v4r.proxy);
    expect([...v4r.reads]).toEqual(["status"]);
  });

  it("leafLoading reads only isLoading (v5) / only status + isFetching (v4)", () => {
    const v5r = recording(asLeaf(v5.pending));
    leafLoading(v5r.proxy);
    expect([...v5r.reads]).toEqual(["isLoading"]);

    const v4r = recording(asLeaf(v4.pending));
    leafLoading(v4r.proxy);
    expect([...v4r.reads]).toEqual(["status", "isFetching"]);
  });

  it("leafStatus reads only status", () => {
    const v5r = recording(asLeaf(v5.success));
    leafStatus(v5r.proxy);
    expect([...v5r.reads]).toEqual(["status"]);

    const v4r = recording(asLeaf(v4.success));
    leafStatus(v4r.proxy);
    expect([...v4r.reads]).toEqual(["status"]);
  });
});
