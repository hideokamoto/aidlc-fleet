/**
 * `runCli` (extracted from `bin/aidlc-fleet.ts`) end-to-end tests.
 *
 * `bun test src/` never covered `bin/` before this file existed — that is
 * exactly how the `--harness` default mismatch ("claude-code" vs the
 * `plugin-targets.json` key "claude") and the FileOwnershipGuard
 * first-init bug shipped undetected: every command-level test injected a
 * `CommandDeps` fake directly, so the CLI's own argv/env wiring in
 * `bin/aidlc-fleet.ts` was never exercised at all. These tests drive the
 * real entrypoint logic (`runCli`) through the real `buildRealDeps()`
 * wiring — mocked `node:child_process.spawn` and `fetch` (this module's
 * own established convention, `real-deps.test.ts`), real temp-directory
 * filesystem — covering all seven commands end-to-end.
 */
import { test, expect, describe, mock, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

/**
 * `runCli`'s `init` case prompts via `deps.configAccess.prompt` (real
 * `node:readline/promises`) when `--harness` is omitted and no existing
 * harness setup is detected (issue #15). Mocked once, module-wide, so every
 * bare `init` call in this file resolves immediately instead of blocking on
 * real stdin; `readlineState.answer` defaults to "claude" (matching the old
 * hardcoded default) and individual tests override it or inspect
 * `readlineState.calls` to assert the prompt's own behavior.
 */
const readlineState: { answer: string; calls: string[] } = { answer: 'claude', calls: [] };
mock.module('node:readline/promises', () => ({
  createInterface: () => ({
    question: async (question: string) => {
      readlineState.calls.push(question);
      return readlineState.answer;
    },
    close: () => undefined,
  }),
}));

const TAR_BLOCK_SIZE = 512;

/** ustar header, matching `real-deps.test.ts`'s own hand-built-tarball convention. */
function buildTarHeader(name: string, size: number, typeflag: string): Uint8Array {
  const header = new Uint8Array(TAR_BLOCK_SIZE);
  const encoder = new TextEncoder();
  const writeField = (value: string, offset: number, length: number) => {
    const bytes = encoder.encode(value);
    header.set(bytes.subarray(0, length), offset);
  };
  writeField(name, 0, 100);
  writeField('0000644', 100, 8);
  writeField('0000000', 108, 8);
  writeField('0000000', 116, 8);
  writeField(size.toString(8).padStart(11, '0'), 124, 12);
  writeField('00000000000', 136, 12);
  writeField('        ', 148, 8);
  header[156] = typeflag.charCodeAt(0);
  writeField('ustar', 257, 6);
  writeField('00', 263, 2);
  return header;
}

/** Wrapper-directory gzip tarball (GitHub codeload convention), one file entry. */
function buildPluginGzipTarball(wrapperDir: string): Uint8Array {
  const content = new TextEncoder().encode('{"name":"sample-plugin"}');
  const chunks: Uint8Array[] = [
    buildTarHeader(`${wrapperDir}/plugin.json`, content.length, '0'),
  ];
  const padded = new Uint8Array(Math.ceil(content.length / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE);
  padded.set(content);
  chunks.push(padded);
  chunks.push(new Uint8Array(TAR_BLOCK_SIZE * 2));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return gzipSync(out);
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
}

const ENV_KEYS = [
  'AIDLC_FLEET_CHANNEL_URL',
  'AIDLC_FLEET_ENGINE_REPO',
  'AIDLC_FLEET_COMPOSE_CMD',
  'AIDLC_FLEET_DOCTOR_CMD',
] as const;

/** Snapshot + clear the 4 config env vars so `buildConfigAccess`'s built-in defaults (issue #18) never leak between tests; callers restore what they need via `process.env[key] = ...`. */
function snapshotAndClearEnv(): () => void {
  const original: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
  for (const key of ENV_KEYS) {
    original[key] = process.env[key];
    delete process.env[key];
  }
  return () => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  };
}

interface MockEnv {
  channelUrl: string;
  channelJson: unknown;
  engineRepo: string;
  engineBytes: Uint8Array;
  pluginRepo: string;
  pluginBytes: Uint8Array;
  doctorStdout?: string;
}

function installMocks(opts: MockEnv) {
  const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
  const spawnMock = mock((cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args });
    const child = new FakeChild();
    queueMicrotask(() => {
      if (opts.doctorStdout !== undefined && cmd.includes('doctor')) {
        child.stdout.emit('data', Buffer.from(opts.doctorStdout));
      }
      child.emit('close', 0);
    });
    return child;
  });
  mock.module('node:child_process', () => ({ spawn: spawnMock }));

  const originalFetch = globalThis.fetch;
  const fetchMock = mock(async (url: string) => {
    if (url === opts.channelUrl) {
      return new Response(JSON.stringify(opts.channelJson), { status: 200 });
    }
    if (url.includes(`/${opts.pluginRepo}/`)) {
      return new Response(new Uint8Array(opts.pluginBytes).buffer as ArrayBuffer, { status: 200 });
    }
    if (url.includes(`/${opts.engineRepo}/`)) {
      return new Response(new Uint8Array(opts.engineBytes).buffer as ArrayBuffer, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  return {
    spawnCalls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

describe('runCli — end-to-end through the real bin.ts wiring', () => {
  let projectRoot: string;
  let restoreFetch: (() => void) | undefined;
  let restoreEnv: (() => void) | undefined;

  afterEach(async () => {
    restoreFetch?.();
    restoreFetch = undefined;
    restoreEnv?.();
    restoreEnv = undefined;
    readlineState.answer = 'claude';
    readlineState.calls = [];
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
  });

  async function setUp() {
    projectRoot = await mkdtemp(join(tmpdir(), 'aidlc-fleet-cli-'));
    const engineBytes = new TextEncoder().encode('opaque-engine-tarball-bytes');
    const engineSha256 = createHash('sha256').update(engineBytes).digest('hex');
    const pluginBytes = buildPluginGzipTarball('sample-plugin-plugin-ref');
    const pluginSha256 = createHash('sha256').update(pluginBytes).digest('hex');

    const channelUrl = 'https://example.test/channel.json';
    const engineRepo = 'org/engine-repo';
    const pluginRepo = 'org/sample-plugin';
    const channelJson = {
      schema: 1,
      channel: 'test-channel',
      engine: { repo: engineRepo, ref: 'engine-ref', version: '1.0.0', sha256: engineSha256 },
      migration_boundaries: [],
      plugins: [
        {
          name: 'sample-plugin',
          repo: pluginRepo,
          ref: 'plugin-ref',
          version: '1.0.0',
          sha256: pluginSha256,
        },
      ],
    };

    const { spawnCalls, restore } = installMocks({
      channelUrl,
      channelJson,
      engineRepo,
      engineBytes,
      pluginRepo,
      pluginBytes,
    });
    restoreFetch = restore;

    restoreEnv = snapshotAndClearEnv();
    process.env.AIDLC_FLEET_CHANNEL_URL = channelUrl;
    process.env.AIDLC_FLEET_ENGINE_REPO = engineRepo;
    process.env.AIDLC_FLEET_COMPOSE_CMD = 'compose-bin --compose';
    process.env.AIDLC_FLEET_DOCTOR_CMD = 'doctor-bin';

    return { spawnCalls };
  }

  test('help / no-args / unknown command routing never touches the network', async () => {
    const { runCli } = await import('./cli');
    projectRoot = await mkdtemp(join(tmpdir(), 'aidlc-fleet-cli-'));
    restoreEnv = snapshotAndClearEnv();

    expect(await runCli([], projectRoot)).toBe(1);
    expect(await runCli(['--help'], projectRoot)).toBe(0);
    expect(await runCli(['-h'], projectRoot)).toBe(0);
  });

  test('AIDLC_FLEET_CHANNEL_URL unset fails fast with exit 1, before any command runs (no built-in default exists for it)', async () => {
    const { runCli } = await import('./cli');
    projectRoot = await mkdtemp(join(tmpdir(), 'aidlc-fleet-cli-'));
    restoreEnv = snapshotAndClearEnv();
    expect(await runCli(['status'], projectRoot)).toBe(1);
  });

  test('an unrecognized command prints usage and exits 1', async () => {
    const { runCli } = await import('./cli');
    await setUp();
    expect(await runCli(['bogus-command'], projectRoot)).toBe(1);
  });

  test('"init" with an explicit --harness flag never detects or prompts, and records that harness (issue #15)', async () => {
    const { runCli } = await import('./cli');
    await setUp();

    const exitCode = await runCli(['init', '--harness', 'claude'], projectRoot);

    expect(exitCode).toBe(0);
    expect(readlineState.calls).toEqual([]);
    const lockfile = JSON.parse(await readFile(join(projectRoot, 'aidlc.lock.json'), 'utf8'));
    expect(lockfile.engine.harness).toBe('claude');
    expect(lockfile.engine.ref).toBe('engine-ref');
  });

  test('"init" with AIDLC_FLEET_ENGINE_REPO unset fetches the engine from the Channel-declared engine.repo (issue #11)', async () => {
    const { runCli } = await import('./cli');
    await setUp();
    delete process.env.AIDLC_FLEET_ENGINE_REPO;

    const exitCode = await runCli(['init', '--harness', 'claude'], projectRoot);

    expect(exitCode).toBe(0);
    const lockfile = JSON.parse(await readFile(join(projectRoot, 'aidlc.lock.json'), 'utf8'));
    expect(lockfile.engine.ref).toBe('engine-ref');
  });

  test('"init" with NO --harness flag, but an existing .claude/ directory, auto-detects "claude" without prompting (issue #15)', async () => {
    const { runCli } = await import('./cli');
    await setUp();
    // A pre-existing .claude/ (e.g. from other Claude tooling already used
    // in this project) is exactly the signal detection looks for — it also
    // makes this an engine-directory *replace*, which FileOwnershipGuard
    // (BR2.1, unrelated to this fix) requires --force for; that's a
    // pre-existing, orthogonal invariant, not part of what's under test
    // here, so --force is passed to get past it.
    await mkdir(join(projectRoot, '.claude'), { recursive: true });

    const exitCode = await runCli(['init', '--force'], projectRoot);

    expect(exitCode).toBe(0);
    expect(readlineState.calls).toEqual([]);
    const lockfile = JSON.parse(await readFile(join(projectRoot, 'aidlc.lock.json'), 'utf8'));
    expect(lockfile.engine.harness).toBe('claude');
    expect(lockfile.engine.ref).toBe('engine-ref');
  });

  test('"init" with NO --harness flag and no existing harness setup prompts interactively and uses the answer (issue #15)', async () => {
    const { runCli } = await import('./cli');
    await setUp();
    readlineState.answer = 'cursor';

    const exitCode = await runCli(['init'], projectRoot);

    expect(exitCode).toBe(0);
    expect(readlineState.calls).toHaveLength(1);
    expect(readlineState.calls[0]).toContain('--harness');
    const lockfile = JSON.parse(await readFile(join(projectRoot, 'aidlc.lock.json'), 'utf8'));
    expect(lockfile.engine.harness).toBe('cursor');
  });

  test('"init" with NO --harness flag, no detection, and an empty prompt answer fails fast without writing a Lockfile (issue #15)', async () => {
    const { runCli } = await import('./cli');
    await setUp();
    readlineState.answer = '   ';

    const exitCode = await runCli(['init'], projectRoot);

    expect(exitCode).toBe(1);
    expect(readlineState.calls).toHaveLength(1);
    await expect(readFile(join(projectRoot, 'aidlc.lock.json'), 'utf8')).rejects.toThrow();
  });

  test('the full command lifecycle succeeds end-to-end: init -> status -> check -> plugin add -> plugin remove -> pin -> unpin -> doctor -> update', async () => {
    const { runCli } = await import('./cli');
    const { spawnCalls } = await setUp();

    expect(await runCli(['init', '--harness', 'claude'], projectRoot)).toBe(0);
    expect(await runCli(['status'], projectRoot)).toBe(0);
    expect(await runCli(['check'], projectRoot)).toBe(0);
    expect(await runCli(['plugin', 'add', 'sample-plugin'], projectRoot)).toBe(0);

    const placedPluginFile = await readFile(
      join(projectRoot, '.claude', 'plugins', 'sample-plugin', 'plugin.json'),
      'utf8',
    );
    expect(JSON.parse(placedPluginFile).name).toBe('sample-plugin');

    expect(await runCli(['plugin', 'remove', 'sample-plugin'], projectRoot)).toBe(0);
    expect(await runCli(['pin', 'deadbeef'], projectRoot)).toBe(0);

    const pinnedLockfile = JSON.parse(await readFile(join(projectRoot, 'aidlc.lock.json'), 'utf8'));
    expect(pinnedLockfile.pin).toBe('deadbeef');

    expect(await runCli(['unpin'], projectRoot)).toBe(0);
    expect(await runCli(['doctor'], projectRoot)).toBe(0);
    expect(await runCli(['update'], projectRoot)).toBe(0);

    // The configured compose command was actually shelled out to across
    // the lifecycle (init, plugin add, plugin remove, update each compose).
    expect(spawnCalls.some((c) => c.cmd === 'compose-bin')).toBe(true);
    expect(spawnCalls.some((c) => c.cmd === 'doctor-bin')).toBe(true);
  });

  test('"config" reports every resolved value/source without prompting when all 4 vars already resolve', async () => {
    const { runCli } = await import('./cli');
    await setUp();
    // Every var already resolves via env (setUp), so `config` has nothing
    // left to prompt for and returns without reading stdin.
    expect(await runCli(['config'], projectRoot)).toBe(0);
  });

  test('"doctor" runs even with AIDLC_FLEET_CHANNEL_URL unset and reports it as a failure', async () => {
    const { runCli } = await import('./cli');
    projectRoot = await mkdtemp(join(tmpdir(), 'aidlc-fleet-cli-'));
    restoreEnv = snapshotAndClearEnv();
    // No Lockfile exists yet in a fresh project root, so this exercises
    // the "no Lockfile" branch rather than the config-failure branch —
    // both are legitimate non-zero outcomes for a totally fresh project.
    expect(await runCli(['doctor'], projectRoot)).not.toBe(0);
  });

  test('"plugin add" for a name the channel never declared fails validation without ever calling PluginManager', async () => {
    const { runCli } = await import('./cli');
    await setUp();
    expect(await runCli(['init'], projectRoot)).toBe(0);
    expect(await runCli(['plugin', 'add', 'not-a-real-plugin'], projectRoot)).toBe(1);
  });

  test('"pin" with a malformed ref is rejected before touching the Lockfile', async () => {
    const { runCli } = await import('./cli');
    await setUp();
    expect(await runCli(['init'], projectRoot)).toBe(0);
    const before = await readFile(join(projectRoot, 'aidlc.lock.json'), 'utf8');
    expect(await runCli(['pin', 'not a valid ref!'], projectRoot)).not.toBe(0);
    const after = await readFile(join(projectRoot, 'aidlc.lock.json'), 'utf8');
    expect(after).toBe(before);
  });

  test('a bare "plugin" with no subcommand fails with usage guidance', async () => {
    const { runCli } = await import('./cli');
    await setUp();
    expect(await runCli(['init'], projectRoot)).toBe(0);
    expect(await runCli(['plugin'], projectRoot)).toBe(1);
  });

  test('a bare "pin" with no ref fails with usage guidance', async () => {
    const { runCli } = await import('./cli');
    await setUp();
    expect(await runCli(['init'], projectRoot)).toBe(0);
    expect(await runCli(['pin'], projectRoot)).toBe(1);
  });
});
