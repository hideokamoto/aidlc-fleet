/**
 * Shared test helper: narrows a possibly-`undefined` value (e.g. an array
 * index read under `noUncheckedIndexedAccess`) without a `!` non-null
 * assertion, throwing with a clear message if the value is actually absent.
 */
export function assertDefined<T>(
  value: T | undefined,
  message = 'expected value to be defined',
): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}
