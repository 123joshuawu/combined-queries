/**
 * Vendored from `@tanstack/query-core` (MIT-licensed, © TanStack).
 *
 * `useCombinedQueries` runs each freshly-assembled keyed object (`data`/`errors`/`status`)
 * through `replaceEqualDeep` against the previous one, returning the prior reference when
 * deeply equal — this is what keeps those objects referentially stable across renders. We
 * vendor the ~40-line utility (rather than importing it from react-query) so this package has
 * *no* runtime dependency on a specific react-query major: the function is identical across
 * v4 and v5, but its export lives in `query-core`, whose major tracks react-query's. Vendoring
 * lets one build run against `@tanstack/react-query` `^4 || ^5`.
 *
 * Source: https://github.com/TanStack/query — packages/query-core/src/utils.ts
 */

const hasOwn = Object.prototype.hasOwnProperty;

function hasObjectPrototype(o: unknown): boolean {
  return Object.prototype.toString.call(o) === "[object Object]";
}

function isPlainArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length === Object.keys(value).length;
}

function isPlainObject(o: unknown): o is Record<string, unknown> {
  if (!hasObjectPrototype(o)) {
    return false;
  }
  const ctor = (o as { constructor?: unknown }).constructor;
  if (ctor === undefined) {
    return true;
  }
  const prot = (ctor as { prototype?: unknown }).prototype;
  if (!hasObjectPrototype(prot)) {
    return false;
  }
  if (!Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf")) {
    return false;
  }
  if (Object.getPrototypeOf(o) !== Object.prototype) {
    return false;
  }
  return true;
}

/**
 * Returns `a` when `a` and `b` are deeply equal; otherwise a new value that structurally
 * shares the parts of `b` that are unchanged from `a`. Mirrors React Query's structural
 * sharing exactly so combined results inherit the same referential-stability semantics.
 */
export function replaceEqualDeep<T>(a: unknown, b: T, depth = 0): T {
  if (a === b) {
    return a as T;
  }
  if (depth > 500) return b;
  const array = isPlainArray(a) && isPlainArray(b);
  if (!array && !(isPlainObject(a) && isPlainObject(b))) return b;
  const aObj = a as Record<PropertyKey, unknown>;
  const bObj = b as Record<PropertyKey, unknown>;
  const aItems = array ? (a as unknown[]) : Object.keys(aObj);
  const aSize = aItems.length;
  const bItems = array ? (b as unknown[]) : Object.keys(bObj);
  const bSize = bItems.length;
  const copy = (array ? new Array(bSize) : {}) as Record<PropertyKey, unknown>;
  let equalItems = 0;
  for (let i = 0; i < bSize; i++) {
    const key = (array ? i : bItems[i]) as PropertyKey;
    const aItem = aObj[key];
    const bItem = bObj[key];
    if (aItem === bItem) {
      copy[key] = aItem;
      if (array ? i < aSize : hasOwn.call(aObj, key)) equalItems++;
      continue;
    }
    if (
      aItem === null ||
      bItem === null ||
      typeof aItem !== "object" ||
      typeof bItem !== "object"
    ) {
      copy[key] = bItem;
      continue;
    }
    const v = replaceEqualDeep(aItem, bItem, depth + 1);
    copy[key] = v;
    if (v === aItem) equalItems++;
  }
  return (aSize === bSize && equalItems === aSize ? a : copy) as T;
}
