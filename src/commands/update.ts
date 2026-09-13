/**
 * `update` command — `functional-spec.md`'s `update` workflow. No
 * business logic: reads the Lockfile via the injected port (BR8.1
 * classification happens in `LockfileStore`, not here), invokes
 * `VersionGate` then `EngineInstaller`, maps the outcome to M8.
 */
import { exitCodeForLockfileAccess, exitCodeForUpdate } from '../core/exit-code';
import type { Channel, ChannelEngine } from '../types/channel';
import type { Lockfile } from '../types/lockfile';
import type { CommandDeps, CommandResult } from './types';

export interface UpdateOptions {
  acknowledgeMigration: boolean;
}

/**
 * Resolve `Lockfile.pin` to a concrete `ChannelEngine` to install and
 * gate against (issue #28). `Channel` carries no lookup table of past
 * engine builds — only the channel's current declared latest — so a pin
 * can only ever be resolved against one of the two `ChannelEngine`-shaped
 * things this CLI actually has in hand:
 *
 *  - the channel's current declared latest (`channel.engine`), when the
 *    pin targets exactly that ref — the pin is "pin to the newest known
 *    build," fully resolvable including a fresh sha256;
 *  - the already-installed engine recorded in the Lockfile
 *    (`lockfile.engine`), when the pin targets exactly that ref — the far
 *    more common "freeze in place" pin, resolved from what was already
 *    verified and installed rather than refetched.
 *
 * A pin matching neither is unresolvable from this Channel declaration —
 * returns `undefined` so the caller can fail safely (respect the pin,
 * refuse to guess) rather than silently falling through to the channel's
 * latest and defeating the pin (the exact bug this fixes).
 */
function resolvePinnedEngine(
  channel: Channel,
  lockfile: Lockfile,
  pin: string,
): ChannelEngine | undefined {
  if (channel.engine.ref === pin) {
    return channel.engine;
  }
  if (lockfile.engine.ref === pin) {
    return {
      repo: channel.engine.repo,
      ref: lockfile.engine.ref,
      version: lockfile.engine.version,
      sha256: lockfile.engine.sha256,
      tag: null,
    };
  }
  return undefined;
}

export async function runUpdate(options: UpdateOptions, deps: CommandDeps): Promise<CommandResult> {
  const loaded = await deps.lockfileStore.loadClassified();
  if (loaded.state !== 'present') {
    deps.stderr('update: no Lockfile found. Run "aidlc-fleet init" first.');
    return { exitCode: exitCodeForLockfileAccess(loaded.state) };
  }

  const { lockfile } = loaded;
  const channel = await deps.channelClient.fetchChannel();

  let targetEngine: ChannelEngine = channel.engine;
  let pinnedTargetVersion: string | undefined;

  if (lockfile.pin) {
    const resolved = resolvePinnedEngine(channel, lockfile, lockfile.pin);
    if (!resolved) {
      deps.stderr(
        `update: pinned ref "${lockfile.pin}" matches neither the channel's current engine ` +
          `(${channel.engine.ref}) nor the installed engine (${lockfile.engine.ref}); unable to ` +
          'resolve a target version to install. Unpin, or wait for the channel to declare that ref, to proceed.',
      );
      return { exitCode: exitCodeForUpdate({ gateAllowed: false, verifierSuccess: false }) };
    }
    targetEngine = resolved;
    pinnedTargetVersion = resolved.version;
  }

  const decision = deps.versionGate.classify(lockfile, channel, {
    acknowledgeMigration: options.acknowledgeMigration,
    pinnedTargetVersion,
  });

  if (!decision.allowed) {
    deps.stderr(`update: rejected by VersionGate (${decision.reason}).`);
    return { exitCode: exitCodeForUpdate({ gateAllowed: false, verifierSuccess: false }) };
  }

  const result = await deps.engineInstaller.install(targetEngine, {
    harness: lockfile.engine.harness,
    force: true,
    isFirstInit: false,
    channelName: channel.channel,
  });

  if (result.success) {
    deps.stdout(`update: engine updated to ${targetEngine.ref}.`);
    // issue #14: see init.ts's identical note — the four-part success
    // check passes an unconfigured doctor by design, but that must be
    // visible here rather than looking identical to a clean doctor run.
    if (!result.doctorConfigured) {
      deps.stdout(
        'update: note — AIDLC_FLEET_DOCTOR_CMD is not configured, so the doctor check did not run.',
      );
    }
  } else {
    deps.stderr('update: install did not pass the four-part success criterion.');
  }

  return { exitCode: exitCodeForUpdate({ gateAllowed: true, verifierSuccess: result.success }) };
}
