/**
 * `plugin add`/`plugin remove` commands — `functional-spec.md`'s
 * `plugin add`/`plugin remove` workflows. Validates the plugin name
 * against the channel's declared `plugins[]` (add) or the Lockfile's
 * currently-placed `plugins[]` (remove) at the argv boundary — per the
 * Code Generation phase guardrail on boundary validation — before
 * invoking `PluginManager`, then maps the outcome to M8.
 */
import { exitCodeForLockfileAccess, exitCodeForPluginOp } from '../core/exit-code';
import type { CommandDeps, CommandResult } from './types';

/**
 * No approved artifact assigns a specific M8 member to "plugin name not
 * recognized/not placed" — it is an argv-boundary validation failure, not
 * a `SuccessVerifier`/`VersionGate`/`DriftDetector` outcome. This build's
 * documented choice: `1`, consistent with `exitCodeForLockfileAccess`'s
 * "needs a corrective action" bucket (see that function's docstring).
 */
const VALIDATION_FAILURE_EXIT_CODE = 1;

export async function runPluginAdd(pluginName: string, deps: CommandDeps): Promise<CommandResult> {
  const loaded = await deps.lockfileStore.loadClassified();
  if (loaded.state !== 'present') {
    deps.stderr('plugin add: no Lockfile found. Run "aidlc-fleet init" first.');
    return { exitCode: exitCodeForLockfileAccess(loaded.state) };
  }

  const channel = await deps.channelClient.fetchChannel();
  const declared = channel.plugins.find((p) => p.name === pluginName);
  if (!declared) {
    deps.stderr(`plugin add: "${pluginName}" is not declared in the channel's plugin set.`);
    return { exitCode: VALIDATION_FAILURE_EXIT_CODE };
  }

  const result = await deps.pluginManager.add(declared);
  if (result.success) {
    deps.stdout(`plugin add: ${pluginName} placed successfully.`);
  } else {
    deps.stderr(`plugin add: ${pluginName} did not pass the four-part success criterion.`);
  }
  return { exitCode: exitCodeForPluginOp(result.success) };
}

export async function runPluginRemove(
  pluginName: string,
  deps: CommandDeps,
): Promise<CommandResult> {
  const loaded = await deps.lockfileStore.loadClassified();
  if (loaded.state !== 'present') {
    deps.stderr('plugin remove: no Lockfile found. Run "aidlc-fleet init" first.');
    return { exitCode: exitCodeForLockfileAccess(loaded.state) };
  }

  const placed = loaded.lockfile.plugins.some((p) => p.name === pluginName);
  if (!placed) {
    deps.stderr(`plugin remove: "${pluginName}" is not currently placed.`);
    return { exitCode: VALIDATION_FAILURE_EXIT_CODE };
  }

  const result = await deps.pluginManager.remove(pluginName);
  if (result.success) {
    deps.stdout(`plugin remove: ${pluginName} removed successfully.`);
  } else {
    deps.stderr(`plugin remove: ${pluginName} did not pass the four-part success criterion.`);
  }
  return { exitCode: exitCodeForPluginOp(result.success) };
}
