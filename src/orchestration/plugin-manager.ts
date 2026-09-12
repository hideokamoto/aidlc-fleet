/**
 * `PluginManager` — places or removes plugin projections and regenerates
 * the sessionStart hook wrapper (`components.md`).
 *
 * Fetches a plugin projection (via `ChannelClient`), refuses to mix
 * versions (BR4.1 — the new projection is placed atomically, replacing
 * any prior one only once fully, successfully extracted; see
 * `placeProjection`'s doc comment below), runs upstream `compose` with
 * `AIDLC_PROJECT_DIR` set (never
 * reimplementing compose's own logic, per project.md's Forbidden rule —
 * this component only shells out to it), and maintains the sessionStart
 * hook wrapper that iterates `lockfile.plugins[]` on every session start.
 *
 * Collaborators are injected as a narrow `PluginManagerPorts` interface
 * rather than concrete `ChannelClient`/`FileOwnershipGuard`/
 * `LockfileStore` instances, so unit tests exercise dispatch/sequencing
 * logic (BR4.1's atomic-placement contract, BR3.1's failure-blocks-the-write behaviour)
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
  /** Remove a plugin's existing projection completely. Used directly by `remove()`; `add()` no longer calls this ahead of `placeProjection` (see below). */
  removeProjection(pluginName: string): Promise<void>;
  /**
   * Place the new projection's verified bytes on disk, replacing any
   * existing projection for `pluginName` atomically (BR4.1): the
   * implementation must extract fully in isolation first and only then
   * replace whatever was previously at the live location, so a failure
   * partway through extraction never leaves a partial live tree and never
   * loses a working old version (real implementation: `real-deps.ts`).
   */
  placeProjection(pluginName: string, bytes: Uint8Array): Promise<void>;
  /** Re-run upstream compose with `AIDLC_PROJECT_DIR` set and stdin closed. */
  runCompose(env: Record<string, string>): Promise<ComposeResult>;
  /** Regenerate the sessionStart hook wrapper's BEGIN/END marker block set to exactly `pluginNames`. */
  regenerateSessionStartHook(pluginNames: string[]): Promise<void>;
  /**
   * Raw doctor failure identifiers, for `SuccessVerifier`'s third
   * predicate, plus `configured` (issue #14): whether a doctor command
   * actually ran. Threaded through to `PluginOpResult.doctorConfigured`
   * so callers can tell "doctor never ran" apart from "doctor ran, found
   * nothing" instead of both looking like an identical clean pass.
   */
  doctorFailures(): Promise<{ failures: string[]; configured: boolean }>;
  /** Project root, exposed for `AIDLC_PROJECT_DIR`. Optional — ports may bake this in instead. */
  projectRoot?: string;
}

export interface PluginOpResult {
  success: boolean;
  compose: ComposeResult;
  pluginSyncClassification: ReturnType<SuccessVerifier['classifyPluginSyncExit']>;
  /** issue #14: whether a doctor command actually ran as part of this operation's verification. */
  doctorConfigured: boolean;
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

    // BR4.1: the old projection (if any) must never survive alongside a
    // partially-placed new one. `placeProjection`'s real implementation
    // extracts the new version in isolation and only replaces the old
    // tree once extraction fully succeeds (CodeRabbit review, issue #5
    // PR #7) — so, unlike before, there is no separate `removeProjection`
    // call here ahead of placement: an explicit pre-removal would delete
    // a working old version before the new one is known-good.
    await this.ports.checkWriteAllowed(this.pluginDirLabel(plugin.name));
    await this.ports.placeProjection(plugin.name, bytes);

    const nextPluginNames = [...new Set([...lockfile.plugins.map((p) => p.name), plugin.name])];
    await this.ports.regenerateSessionStartHook(nextPluginNames);

    const compose = await this.ports.runCompose({
      AIDLC_PROJECT_DIR: this.ports.projectRoot ?? '',
    });
    const pluginSyncClassification = this.verifier.classifyPluginSyncExit(compose.exitCode);

    const { failures: doctorFailures, configured: doctorConfigured } =
      await this.ports.doctorFailures();
    const verification = this.verifier.verify({
      composeExitCode: compose.exitCode,
      dropsFileContent: compose.dropsFileContent,
      doctorFailures,
      doctorConfigured,
      knownFailures: lockfile.known_failures,
    });

    if (!verification.success) {
      return { success: false, compose, pluginSyncClassification, doctorConfigured };
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

    return { success: true, compose, pluginSyncClassification, doctorConfigured };
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

    const { failures: doctorFailures, configured: doctorConfigured } =
      await this.ports.doctorFailures();
    const verification = this.verifier.verify({
      composeExitCode: compose.exitCode,
      dropsFileContent: compose.dropsFileContent,
      doctorFailures,
      doctorConfigured,
      knownFailures: lockfile.known_failures,
    });

    if (!verification.success) {
      return { success: false, compose, pluginSyncClassification, doctorConfigured };
    }

    const nextPlugins = lockfile.plugins.filter((p) => p.name !== pluginName);
    await this.ports.saveLockfile({ ...lockfile, plugins: nextPlugins });

    return { success: true, compose, pluginSyncClassification, doctorConfigured };
  }

  /**
   * issue #5 (FR3.1): プラグインの論理名のみを返す。物理的な書き込み先
   * パス（`.claude/plugins/<name>`）との合成は行わない — その合成は
   * `real-deps.ts` の `checkWriteAllowed` クロージャ（統合グルー層）の
   * 責務であり、`FileOwnershipGuard` が実際の書き込み先に対してシンボ
   * リックリンク検査（M4, BR2.4）を行えるようにする（修正前は
   * `plugins/<name>` を返しており、`projectRoot` と合成すると
   * `<projectRoot>/plugins/<name>` という実際には書き込まれない誤った
   * パスを検査していた）。全3呼び出し箇所（`add()` 2箇所, `remove()` 1
   * 箇所）が一貫してこのメソッド経由で呼ばれる（FR3.3）。
   */
  private pluginDirLabel(pluginName: string): string {
    return pluginName;
  }
}
