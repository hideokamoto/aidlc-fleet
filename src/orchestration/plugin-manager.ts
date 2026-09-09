/**
 * `PluginManager` — places or removes plugin projections and regenerates
 * the sessionStart hook wrapper (`components.md`).
 *
 * Fetches a plugin projection (via `ChannelClient`), refuses to mix
 * versions (BR4.1 — removes the prior projection before placing a new
 * one), runs upstream `compose` with `AIDLC_PROJECT_DIR` set (never
 * reimplementing compose's own logic, per project.md's Forbidden rule —
 * this component only shells out to it), and maintains the sessionStart
 * hook wrapper that iterates `lockfile.plugins[]` on every session start.
 *
 * Collaborators are injected as a narrow `PluginManagerPorts` interface
 * rather than concrete `ChannelClient`/`FileOwnershipGuard`/
 * `LockfileStore` instances, so unit tests exercise dispatch/sequencing
 * logic (BR4.1's ordering, BR3.1's failure-blocks-the-write behaviour)
 * without touching the filesystem, network, or a child process — those
 * concerns are already covered by each port's own owning component's
 * tests (`ChannelClient`, `FileOwnershipGuard`, `LockfileStore`).
 */
import { SuccessVerifier } from '../core/success-verifier';
import type { ChannelPlugin } from '../types/channel';
import type { Lockfile, LockfilePlugin } from '../types/lockfile';

export interface ComposeResult {
  exitCode: number;
  dropsFileContent: string;
}

export interface PluginManagerPorts {
  /** `PluginManager -> ChannelClient`: fetch plugin projections (`components.md`'s approved edge). */
  fetchPluginTarball(plugin: ChannelPlugin): Promise<Uint8Array>;
  /** `PluginManager -> FileOwnershipGuard`: enforce invariants during plugin placement/removal. */
  checkWriteAllowed(targetPath: string): Promise<void>;
  loadLockfile(): Promise<Lockfile>;
  saveLockfile(lockfile: Lockfile): Promise<void>;
  /** Remove a plugin's existing projection completely (BR4.1). */
  removeProjection(pluginName: string): Promise<void>;
  /** Place the new projection's verified bytes on disk. */
  placeProjection(pluginName: string, bytes: Uint8Array): Promise<void>;
  /** Re-run upstream compose with `AIDLC_PROJECT_DIR` set and stdin closed. */
  runCompose(env: Record<string, string>): Promise<ComposeResult>;
  /** Regenerate the sessionStart hook wrapper's BEGIN/END marker block set to exactly `pluginNames`. */
  regenerateSessionStartHook(pluginNames: string[]): Promise<void>;
  /** Raw doctor failure identifiers, for `SuccessVerifier`'s third predicate. */
  doctorFailures(): Promise<string[]>;
  /** Project root, exposed for `AIDLC_PROJECT_DIR`. Optional — ports may bake this in instead. */
  projectRoot?: string;
}

export interface PluginOpResult {
  success: boolean;
  compose: ComposeResult;
  pluginSyncClassification: ReturnType<SuccessVerifier['classifyPluginSyncExit']>;
}

export class PluginManager {
  private readonly ports: PluginManagerPorts;
  private readonly verifier: SuccessVerifier;

  constructor(ports: PluginManagerPorts, verifier: SuccessVerifier = new SuccessVerifier()) {
    this.ports = ports;
    this.verifier = verifier;
  }

  /** `plugin add <name>` workflow (functional-spec.md). */
  async add(plugin: ChannelPlugin): Promise<PluginOpResult> {
    const bytes = await this.ports.fetchPluginTarball(plugin);
    const lockfile = await this.ports.loadLockfile();

    // BR4.1: remove any prior projection completely before placing the new one.
    const existing = lockfile.plugins.find((p) => p.name === plugin.name);
    if (existing) {
      await this.ports.checkWriteAllowed(this.pluginDirLabel(plugin.name));
      await this.ports.removeProjection(plugin.name);
    }

    await this.ports.checkWriteAllowed(this.pluginDirLabel(plugin.name));
    await this.ports.placeProjection(plugin.name, bytes);

    const nextPluginNames = [...new Set([...lockfile.plugins.map((p) => p.name), plugin.name])];
    await this.ports.regenerateSessionStartHook(nextPluginNames);

    const compose = await this.ports.runCompose({
      AIDLC_PROJECT_DIR: this.ports.projectRoot ?? '',
    });
    const pluginSyncClassification = this.verifier.classifyPluginSyncExit(compose.exitCode);

    const doctorFailures = await this.ports.doctorFailures();
    const verification = this.verifier.verify({
      composeExitCode: compose.exitCode,
      dropsFileContent: compose.dropsFileContent,
      doctorFailures,
      knownFailures: lockfile.known_failures,
    });

    if (!verification.success) {
      return { success: false, compose, pluginSyncClassification };
    }

    const nextPlugin: LockfilePlugin = {
      name: plugin.name,
      ref: plugin.ref,
      version: plugin.version,
      sha256: plugin.sha256,
      composed_at: new Date().toISOString(),
      engine_version_at_compose: lockfile.engine.version,
    };
    const nextPlugins = [...lockfile.plugins.filter((p) => p.name !== plugin.name), nextPlugin];
    await this.ports.saveLockfile({ ...lockfile, plugins: nextPlugins });

    return { success: true, compose, pluginSyncClassification };
  }

  /** `plugin remove <name>` workflow (functional-spec.md). */
  async remove(pluginName: string): Promise<PluginOpResult> {
    const lockfile = await this.ports.loadLockfile();

    // Removal is still a mutating operation subject to BR2.1-BR2.5.
    await this.ports.checkWriteAllowed(this.pluginDirLabel(pluginName));
    await this.ports.removeProjection(pluginName);

    const remainingPluginNames = lockfile.plugins
      .map((p) => p.name)
      .filter((name) => name !== pluginName);
    await this.ports.regenerateSessionStartHook(remainingPluginNames);

    const compose = await this.ports.runCompose({
      AIDLC_PROJECT_DIR: this.ports.projectRoot ?? '',
    });
    const pluginSyncClassification = this.verifier.classifyPluginSyncExit(compose.exitCode);

    const doctorFailures = await this.ports.doctorFailures();
    const verification = this.verifier.verify({
      composeExitCode: compose.exitCode,
      dropsFileContent: compose.dropsFileContent,
      doctorFailures,
      knownFailures: lockfile.known_failures,
    });

    if (!verification.success) {
      return { success: false, compose, pluginSyncClassification };
    }

    const nextPlugins = lockfile.plugins.filter((p) => p.name !== pluginName);
    await this.ports.saveLockfile({ ...lockfile, plugins: nextPlugins });

    return { success: true, compose, pluginSyncClassification };
  }

  private pluginDirLabel(pluginName: string): string {
    return `plugins/${pluginName}`;
  }
}
