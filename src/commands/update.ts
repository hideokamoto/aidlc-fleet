/**
 * `update` command — `functional-spec.md`'s `update` workflow. No
 * business logic: reads the Lockfile via the injected port (BR8.1
 * classification happens in `LockfileStore`, not here), invokes
 * `VersionGate` then `EngineInstaller`, maps the outcome to M8.
 */
import { exitCodeForLockfileAccess, exitCodeForUpdate } from '../core/exit-code';
import type { CommandDeps, CommandResult } from './types';

export interface UpdateOptions {
  acknowledgeMigration: boolean;
}

export async function runUpdate(options: UpdateOptions, deps: CommandDeps): Promise<CommandResult> {
  const loaded = await deps.lockfileStore.loadClassified();
  if (loaded.state !== 'present') {
    deps.stderr('update: no Lockfile found. Run "aidlc-fleet init" first.');
    return { exitCode: exitCodeForLockfileAccess(loaded.state) };
  }

  const channel = await deps.channelClient.fetchChannel();
  const decision = deps.versionGate.classify(loaded.lockfile, channel, {
    acknowledgeMigration: options.acknowledgeMigration,
  });

  if (!decision.allowed) {
    deps.stderr(`update: rejected by VersionGate (${decision.reason}).`);
    return { exitCode: exitCodeForUpdate({ gateAllowed: false, verifierSuccess: false }) };
  }

  const result = await deps.engineInstaller.install(channel.engine, {
    harness: loaded.lockfile.engine.harness,
    force: true,
    isFirstInit: false,
  });

  if (result.success) {
    deps.stdout(`update: engine updated to ${channel.engine.ref}.`);
  } else {
    deps.stderr('update: install did not pass the four-part success criterion.');
  }

  return { exitCode: exitCodeForUpdate({ gateAllowed: true, verifierSuccess: result.success }) };
}
