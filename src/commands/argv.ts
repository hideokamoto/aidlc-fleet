/**
 * Shared argv-parsing helpers (extracted during the API/endpoint layer's
 * Refactor step, plan Step 14) — every command's flag parsing goes
 * through these instead of re-implementing `--flag`/`--flag=value`
 * scanning per command.
 */

/** Does `args` contain the boolean flag `--name`? */
export function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

/** Read `--name value` or `--name=value` from `args`, or `undefined` if absent. */
export function readOption(args: string[], name: string): string | undefined {
  const withEquals = args.find((arg) => arg.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return args[index + 1];
}

/**
 * Default harness when `--harness` is omitted. Must be a key
 * `.claude/tools/data/plugin-targets.json` actually resolves (real-deps.ts's
 * `resolveHarnessRoot`) — `"claude-code"` is not such a key and made every
 * bare `init`/`update` fail with "unknown harness" against the real CLI.
 */
export const DEFAULT_HARNESS = 'claude';

/** Resolve the `--harness` value for a command's argv, falling back to {@link DEFAULT_HARNESS}. */
export function resolveHarness(args: string[]): string {
  return readOption(args, 'harness') ?? DEFAULT_HARNESS;
}

/** Positional (non-flag) arguments, in order — everything not starting with `--` and not consumed as an option value is left to the caller to slice manually for simple single-positional commands. */
export function positionals(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--')) {
      // Skip a following value only for `--flag value` form (not `--flag=value`,
      // already self-contained, and not a boolean flag followed by another flag).
      if (!arg.includes('=') && args[i + 1] !== undefined && !args[i + 1]?.startsWith('--')) {
        i += 1;
      }
      continue;
    }
    result.push(arg);
  }
  return result;
}
