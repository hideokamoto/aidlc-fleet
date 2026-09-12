/**
 * `status` command — `functional-spec.md`'s `status` workflow. Read-only;
 * composes a human-readable summary and exits 0 unless the Lockfile
 * itself is absent/malformed (BR8.1 is the only status failure mode —
 * drift is reported content, never a status-command failure).
 */
import { exitCodeForLockfileAccess } from '../core/exit-code';
import { ENV_CONFIG_KEYS } from '../core/env-config-resolver';
import type { CommandDeps, CommandResult } from './types';

export async function runStatus(deps: CommandDeps): Promise<CommandResult> {
  const loaded = await deps.lockfileStore.loadClassified();
  if (loaded.state !== 'present') {
    deps.stderr('status: no Lockfile found. Run "aidlc-fleet init" first.');
    return { exitCode: exitCodeForLockfileAccess(loaded.state) };
  }

  const { lockfile } = loaded;
  const channel = await deps.channelClient.fetchChannel();
  const installed = await deps.installedState.read();
  const drift = deps.driftDetector.summarize(lockfile, channel, installed);

  const lines = [
    `channel: ${lockfile.channel}`,
    `engine: ${lockfile.engine.version} (${lockfile.engine.ref})`,
    `plugins: ${lockfile.plugins.map((p) => `${p.name}@${p.version}`).join(', ') || '(none)'}`,
    `pin: ${lockfile.pin ?? '(none)'}`,
    `drift: ${drift.status}`,
  ];

  // issue #18: surface where each of the 4 AIDLC_FLEET_* values came
  // from, so a stale local-config entry or a missing var is visible
  // without a separate `env | grep` step. A malformed local-config file
  // is content to report, not a status-command failure — status's own
  // contract keeps BR8.1 (Lockfile absent/malformed) as its only failure
  // mode (code-review finding).
  try {
    const resolvedConfig = await deps.configAccess.resolveAll();
    for (const key of ENV_CONFIG_KEYS) {
      const entry = resolvedConfig[key];
      lines.push(`${key}: ${entry.value ?? '(unset)'} (${entry.source})`);
    }
  } catch (err) {
    lines.push(
      `config: local config file is malformed (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  deps.stdout(lines.join('\n'));

  return { exitCode: 0 };
}
