/**
 * `EngineInstaller` — places the engine (Cursor `install.ts` wrapper, or
 * receipt-diff for other harnesses) and re-runs compose (`components.md`).
 *
 * Always re-runs compose afterward regardless of harness (idempotent per
 * P2). `VersionGate` gates `update`; `init`'s first install skips the
 * gate entirely (`functional-spec.md`'s `init` workflow step 4).
 *
 * Never reimplements upstream `install.ts`/`compose.ts` — this component
 * only shells out to it via the injected `runCompose`/`placeEngine`
 * ports (project.md's Forbidden rule).
 */
import { SuccessVerifier } from '../core/success-verifier';
import type { ChannelEngine } from '../types/channel';
import type { Lockfile } from '../types/lockfile';

export interface ComposeResult {
  exitCode: number;
  dropsFileContent: string;
}

export interface EngineInstallerPorts {
  /** `EngineInstaller -> ChannelClient`: fetch the engine tarball. */
  fetchEngineTarball(engine: ChannelEngine): Promise<Uint8Array>;
  /** `EngineInstaller -> FileOwnershipGuard`: enforce invariants during engine placement (BR2.1-BR2.4). Throws on violation. `harness` is threaded through so the caller can resolve the harness-specific engine-owned directory (issue #6) instead of assuming a single hardcoded location. */
  checkEngineDirectoryReplace(opts: { force: boolean; harness: string }): Promise<void>;
  /** Place the verified engine bytes for `harness` (install.ts wrapper for Cursor, receipt-diff otherwise). */
  placeEngine(bytes: Uint8Array, harness: string): Promise<void>;
  /** Re-run upstream compose. */
  runCompose(env: Record<string, string>): Promise<ComposeResult>;
  doctorFailures(): Promise<string[]>;
  /** Existing Lockfile, when this is an update (undefined on first init). */
  loadLockfile(): Promise<Lockfile | undefined>;
  saveLockfile(lockfile: Lockfile): Promise<void>;
  projectRoot?: string;
}

export interface EngineInstallOptions {
  harness: string;
  /** BR2.1: required to replace an already-existing engine-owned directory. */
  force: boolean;
  /** `init` skips the VersionGate entirely; `update` does not call this component until the gate has already passed. */
  isFirstInit: boolean;
  /** `init --adopt`: records the adoption marker BR1.5 later consumes. */
  adopt?: boolean;
}

export interface EngineInstallResult {
  success: boolean;
  compose: ComposeResult;
}

const ADOPTED_MARKER = 'adopted';

export class EngineInstaller {
  private readonly ports: EngineInstallerPorts;
  private readonly verifier: SuccessVerifier;

  constructor(ports: EngineInstallerPorts, verifier: SuccessVerifier = new SuccessVerifier()) {
    this.ports = ports;
    this.verifier = verifier;
  }

  /** `init`/`update`'s shared engine-placement steps (`functional-spec.md` init steps 5-9, update step 7). */
  async install(
    engine: ChannelEngine,
    options: EngineInstallOptions,
  ): Promise<EngineInstallResult> {
    const bytes = await this.ports.fetchEngineTarball(engine);

    // BR2.1-BR2.4: fail fast before any write if the guard refuses.
    await this.ports.checkEngineDirectoryReplace({ force: options.force, harness: options.harness });

    await this.ports.placeEngine(bytes, options.harness);

    const compose = await this.ports.runCompose({
      AIDLC_PROJECT_DIR: this.ports.projectRoot ?? '',
    });

    const previous = await this.ports.loadLockfile();
    const doctorFailures = await this.ports.doctorFailures();
    const verification = this.verifier.verify({
      composeExitCode: compose.exitCode,
      dropsFileContent: compose.dropsFileContent,
      doctorFailures,
      knownFailures: previous?.known_failures ?? [],
    });

    if (!verification.success) {
      return { success: false, compose };
    }

    const installedAt = new Date().toISOString();
    const nextManaged = options.adopt
      ? [...new Set([...(previous?.managed ?? []), ADOPTED_MARKER])]
      : (previous?.managed ?? []);

    const nextLockfile: Lockfile = {
      schema: previous?.schema ?? 1,
      channel: previous?.channel ?? '',
      channel_commit: previous?.channel_commit ?? '',
      engine: {
        ref: engine.ref,
        version: engine.version,
        sha256: engine.sha256,
        harness: options.harness,
        installed_at: installedAt,
      },
      // engine_origin is the version-gate anchor (M3): set once on the
      // Lockfile's creation transition, then never overwritten by a
      // later update.
      engine_origin: previous?.engine_origin ?? engine.ref,
      plugins: previous?.plugins ?? [],
      managed: nextManaged,
      known_failures: previous?.known_failures ?? [],
      pin: previous?.pin ?? null,
    };
    await this.ports.saveLockfile(nextLockfile);

    return { success: true, compose };
  }
}
