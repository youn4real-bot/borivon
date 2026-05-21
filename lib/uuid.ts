/**
 * Shared UUID validator. 34 route handlers used to inline this same
 * regex — consolidate so a future tweak (e.g. accept UUIDv7) is a
 * one-line change.
 */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}
