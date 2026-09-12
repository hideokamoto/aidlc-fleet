/**
 * Shared types for the `CommandLayer` (`src/commands/*.ts`,
 * `bin/aidlc-fleet.ts`). This layer contains no business logic of its
 * own — a pure argv-parsing/dispatch/exit-code-mapping layer over an
 * injected core-logic bundle (`components.md`'s `CommandLayer`
 * description; team.md's mandated layer separation). Every command
 * module's tests inject a mock `CommandDeps`, never a real
 * `ChannelClient`/`LockfileStore`/etc., so these tests assert only
 * parsing, dispatch, and exit-code mapping — business logic is already
 * covered by each core-logic component's own tests.
 */
import type { Channel, ChannelPlugin } from '../types/channel';
import type { Lockfile } from '../types/lockfile';
import type { VersionGate } from '../core/version-gate';
import type { SuccessVerifier } from '../core/success-verifier';
import type { DriftDetector, InstalledState } from '../core/drift-detector';
import type { PluginOpResult } from '../orchestration/plugin-manager';
import type { EngineInstallResult, EngineInstallOptions } from '../orchestration/engine-installer';
import type { ResolvedConfig, LocalConfigValues } from '../core/env-config-resolver';

export type LockfileAccessState = 'present' | 'absent' | 'malformed';

/** Narrow port onto `LockfileStore`, sufficient for every command's needs. */
export interface LockfileAccess {
  /** Load the Lockfile, classifying absent/malformed (BR8.1) into a tagged result instead of throwing, so `CommandLayer` can map it to an exit code without inspecting error types itself. */
  loadClassified(): Promise<
    { state: 'present'; lockfile: Lockfile } | { state: 'absent' | 'malformed' }
  >;
  save(lockfile: Lockfile): Promise<void>;
  pin(ref: string): Promise<void>;
  unpin(): Promise<void>;
}

/** Narrow port onto `ChannelClient`, sufficient for every command's needs. */
export interface ChannelAccess {
  fetchChannel(): Promise<Channel>;
}

/** Narrow port onto `EngineInstaller`. */
export interface EngineInstallAccess {
  install(engine: Channel['engine'], options: EngineInstallOptions): Promise<EngineInstallResult>;
}

/** Narrow port onto `PluginManager`. */
export interface PluginAccess {
  add(plugin: ChannelPlugin): Promise<PluginOpResult>;
  remove(pluginName: string): Promise<PluginOpResult>;
}

/** Narrow port for observing what is actually installed on disk, feeding `DriftDetector`. */
export interface InstalledStateAccess {
  read(): Promise<InstalledState>;
}

/** Narrow port onto upstream `doctor`, wrapped by `SuccessVerifier` (BR3.4, S2). */
export interface DoctorRunner {
  run(): Promise<{ failures: string[] }>;
}

/**
 * Narrow port for the 4 `AIDLC_FLEET_*` env vars (issue #18):
 * env > local-config file > built-in default > unset, plus the ability
 * for `config` to prompt for and persist an unset value.
 */
export interface ConfigAccess {
  resolveAll(): Promise<ResolvedConfig>;
  saveLocal(values: LocalConfigValues): Promise<void>;
  prompt(question: string): Promise<string>;
}

export interface CommandDeps {
  lockfileStore: LockfileAccess;
  channelClient: ChannelAccess;
  versionGate: VersionGate;
  engineInstaller: EngineInstallAccess;
  pluginManager: PluginAccess;
  driftDetector: DriftDetector;
  successVerifier: SuccessVerifier;
  installedState: InstalledStateAccess;
  doctorRunner: DoctorRunner;
  configAccess: ConfigAccess;
  /** Where output is written — injected so tests capture it instead of writing to real stdout. */
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface CommandResult {
  exitCode: number;
}
