/** Structural equality of JSON values, ignoring object key order. */
export function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    const other = right as unknown[];
    return left.length === other.length && left.every((item, index) => sameJson(item, other[index]));
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter(key => a[key] !== undefined);
  return keys.length === Object.keys(b).filter(key => b[key] !== undefined).length
    && keys.every(key => sameJson(a[key], b[key]));
}

/** `native.equals`: every listed field equals the stored value's field. */
export function nativeValueMatches(stored: unknown, expected: Record<string, unknown>): boolean {
  if (typeof stored !== 'object' || stored === null) return false;
  const value = stored as Record<string, unknown>;
  return Object.entries(expected).every(([key, field]) => sameJson(value[key] ?? null, field ?? null));
}

/** Thrown inside a commit to roll it back and report which check or write failed. */
export class CommitFailure extends Error {
  constructor(readonly kind: 'check' | 'write', readonly index: number, message?: string) {
    super(message ?? `${kind} ${index} failed`);
  }
}
