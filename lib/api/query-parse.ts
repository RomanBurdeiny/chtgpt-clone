/**
 * Optional integer query param: invalid or missing values fall back to `defaultValue`;
 * numeric values are clamped to [min, max].
 */
export function parseClampedIntParam(
  searchParams: URLSearchParams,
  key: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const raw = searchParams.get(key);
  if (raw === null || raw === "") return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.min(max, Math.max(min, n));
}
