/**
 * `DriftDetector` — compares lockfile, channel, and on-disk state to
 * detect drift for `check` (M6) and the drift portion of `status` (S3).
 * `components.md`. Reads state only; never writes.
 */
import type { Channel } from '../types/channel';
import type { Lockfile } from '../types/lockfile';

export type DriftStatus = 'in-sync' | 'behind-channel' | 'local-modification';

export interface InstalledState {
  /** The engine ref actually installed on disk, as observed by the caller. */
  installedEngineRef: string;
  /** Installed plugin refs by plugin name, as observed by the caller. */
  installedPluginRefs: Record<string, string>;
}

export interface DriftResult {
  status: DriftStatus;
  /** BR5.2's canonical exit-code mapping: 0 in-sync, 1 behind-channel, 2 local-modification. */
  exitCode: 0 | 1 | 2;
  /** The ref this comparison targeted (channel's latest, or the pin when one is set — BR5.3). */
  targetEngineRef: string;
}

export class DriftDetector {
  /** BR5.1–BR5.3: the three-way comparison, mapped to `check`'s exit-code contract. */
  compare(lockfile: Lockfile, channel: Channel, installed: InstalledState): DriftResult {
    // BR5.3: a pin substitutes for the channel's latest in the comparison.
    const targetEngineRef = lockfile.pin ?? channel.engine.ref;

    const diskMatchesLockfile =
      installed.installedEngineRef === lockfile.engine.ref &&
      lockfile.plugins.every((plugin) => installed.installedPluginRefs[plugin.name] === plugin.ref);

    if (!diskMatchesLockfile) {
      // Disk disagrees with what the lockfile declares — local edits happened
      // outside this CLI's own writes.
      return { status: 'local-modification', exitCode: 2, targetEngineRef };
    }

    const lockfileMatchesTarget =
      lockfile.engine.ref === targetEngineRef &&
      channel.plugins.every((channelPlugin) => {
        const lockfilePlugin = lockfile.plugins.find((p) => p.name === channelPlugin.name);
        return lockfilePlugin === undefined || lockfilePlugin.ref === channelPlugin.ref;
      });

    if (!lockfileMatchesTarget) {
      return { status: 'behind-channel', exitCode: 1, targetEngineRef };
    }

    return { status: 'in-sync', exitCode: 0, targetEngineRef };
  }

  /** Same comparison as {@link compare}, framed for `status` (S3) — reports rather than being treated as a command failure by the caller. */
  summarize(lockfile: Lockfile, channel: Channel, installed: InstalledState): DriftResult {
    return this.compare(lockfile, channel, installed);
  }
}
