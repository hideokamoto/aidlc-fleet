/**
 * Tests for `real-deps.ts`'s doctor-invocation wiring (R-02): the
 * `AIDLC_FLEET_DOCTOR_CMD`-configurable external `doctor` invocation and
 * its stdout-to-failures parser. Mirrors `runComposeCommand`'s existing
 * shell-out pattern; `child_process.spawn` is mocked so these tests never
 * actually spawn a process, matching this module's own doc comment on
 * why it has no dedicated business-logic test cycle beyond what genuinely
 * branches here (the parsing/invocation logic added for R-02 does).
 */
import { test, expect, describe, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const TAR_BLOCK_SIZE = 512;

/**
 * Builds a minimal valid `.tar.gz` fixture containing one file entry
 * wrapped in a `<wrapperDirName>/` directory, mirroring the GitHub
 * codeload archive shape `real-deps.ts`'s `placeEngine`/`placeProjection`
 * now actually extract (`extractTarGzToDir` with `stripComponents: 1`).
 */
function buildTarGzFixture(
  wrapperDirName: string,
  filePath: string,
  fileContent: string,
): Uint8Array {
  const header = new Uint8Array(TAR_BLOCK_SIZE);
  const name = `${wrapperDirName}/${filePath}`;
  header.set(Buffer.from(name, 'utf8').subarray(0, 100), 0);
  const contentBytes = Buffer.from(fileContent, 'utf8');
  header.set(Buffer.from(contentBytes.length.toString(8).padStart(11, '0'), 'utf8'), 124);
  header.set(Buffer.from('ustar\0', 'utf8'), 257);
  header.set(Buffer.from('00', 'utf8'), 263);
  const paddedContentLength = Math.ceil(contentBytes.length / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  const paddedContent = new Uint8Array(paddedContentLength);
  paddedContent.set(contentBytes, 0);
  const tar = new Uint8Array(header.length + paddedContent.length + TAR_BLOCK_SIZE * 2);
  tar.set(header, 0);
  tar.set(paddedContent, header.length);
  return gzipSync(Buffer.from(tar));
}

/**
 * Bug fix: `buildRealDeps()` used to hand `engine.ref`/`plugin.ref` (a bare
 * commit SHA, per `contract-summary.md` Contract 1) directly to
 * `ChannelClient.fetchTarball` as if it were a URL, which crashes with
 * `ERR_INVALID_URL` on any real channel (verified by hand against a local
 * HTTP server before this fix). `buildTarballUrl` closes that gap by
 * combining a repo (`owner/name`, already present on `ChannelPlugin.repo`,
 * newly configured for the engine via `AIDLC_FLEET_ENGINE_REPO`) with the
 * ref into GitHub's codeload tarball URL.
 */
describe('buildTarballUrl', () => {
  test('combines repo and ref into a GitHub codeload tarball URL', async () => {
    const { buildTarballUrl } = await import('./real-deps');
    expect(buildTarballUrl('awslabs/aidlc-workflows', 'e1e1e1e1e1e1')).toBe(
      'https://codeload.github.com/awslabs/aidlc-workflows/tar.gz/e1e1e1e1e1e1',
    );
  });

  test('rejects an empty repo rather than building a malformed URL', async () => {
    const { buildTarballUrl } = await import('./real-deps');
    expect(() => buildTarballUrl('', 'e1e1e1e1e1e1')).toThrow(/repo/);
  });
});

describe('parseDoctorOutput', () => {
  test('treats each non-blank, non-comment line as one failure', async () => {
    const { parseDoctorOutput } = await import('./real-deps');
    const out = parseDoctorOutput('missing plugin foo\nstale engine ref\n');
    expect(out).toEqual(['missing plugin foo', 'stale engine ref']);
  });

  test('drops blank lines and lines starting with "#"', async () => {
    const { parseDoctorOutput } = await import('./real-deps');
    const out = parseDoctorOutput('# doctor report\n\nmissing plugin foo\n   \n# end\n');
    expect(out).toEqual(['missing plugin foo']);
  });

  test('empty stdout parses to no failures', async () => {
    const { parseDoctorOutput } = await import('./real-deps');
    expect(parseDoctorOutput('')).toEqual([]);
  });

  test('trims surrounding whitespace on each retained line', async () => {
    const { parseDoctorOutput } = await import('./real-deps');
    expect(parseDoctorOutput('  missing plugin foo  \n')).toEqual(['missing plugin foo']);
  });
});

describe('runDoctorCommand', () => {
  test('returns no failures without spawning when no doctor command is configured', async () => {
    const spawnMock = mock(() => {
      throw new Error('spawn should not be called when doctorCommand is unset');
    });
    mock.module('node:child_process', () => ({ spawn: spawnMock }));
    const { runDoctorCommand } = await import('./real-deps');

    const result = await runDoctorCommand(undefined, {});
    expect(result.failures).toEqual([]);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  test('spawns the configured command, captures stdout, and parses failure lines', async () => {
    class FakeChild extends EventEmitter {
      stdout = new EventEmitter();
    }
    const child = new FakeChild();
    const spawnMock = mock((_cmd: string, _args: string[], _opts: unknown) => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('missing plugin foo\n'));
        child.stdout.emit('data', Buffer.from('stale engine ref\n'));
        child.emit('close', 0);
      });
      return child;
    });
    mock.module('node:child_process', () => ({ spawn: spawnMock }));
    const { runDoctorCommand } = await import('./real-deps');

    const result = await runDoctorCommand(['doctor-bin', '--json'], { AIDLC_PROJECT_DIR: '/p' });
    expect(result.failures).toEqual(['missing plugin foo', 'stale engine ref']);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnMock.mock.calls[0]!;
    expect(cmd).toBe('doctor-bin');
    expect(args).toEqual(['--json']);
  });

  test('rejects when the spawned process errors', async () => {
    class FakeChild extends EventEmitter {
      stdout = new EventEmitter();
    }
    const child = new FakeChild();
    const spawnMock = mock(() => {
      queueMicrotask(() => child.emit('error', new Error('ENOENT: doctor-bin not found')));
      return child;
    });
    mock.module('node:child_process', () => ({ spawn: spawnMock }));
    const { runDoctorCommand } = await import('./real-deps');

    await expect(runDoctorCommand(['doctor-bin'], {})).rejects.toThrow(/ENOENT/);
  });
});

/**
 * R-02 iteration-2 fix: `buildRealDeps().pluginManager`'s `doctorFailures`
 * port used to be hardwired to `async () => []` (the original always-empty
 * stub), so `PluginManager.add()`/`remove()` could never fail
 * `SuccessVerifier`'s BR3.1 third predicate through the real binary no
 * matter what upstream `doctor` reported. These tests exercise the wired
 * port end-to-end through `pluginManager.remove()` (compose + doctor are
 * both invoked via mocked `child_process.spawn`, exactly like
 * `runDoctorCommand`'s own tests above) and confirm the doctor command is
 * actually invoked and its parsed failures actually flow into the
 * verification outcome — not just that the port exists.
 */
describe('buildRealDeps().pluginManager doctorFailures wiring', () => {
  async function makeProjectRoot(): Promise<string> {
    const projectRoot = await mkdtemp(join(tmpdir(), 'aidlc-fleet-real-deps-'));
    const lockfile = {
      schema: 1,
      channel: 'stable',
      channel_commit: 'abc123',
      engine: {
        ref: 'engine-ref',
        version: '0.1.0',
        sha256: 'deadbeef',
        harness: 'claude-code',
        installed_at: '2026-01-01T00:00:00.000Z',
      },
      engine_origin: '0.1.0',
      plugins: [
        {
          name: 'example-plugin',
          ref: 'plugin-ref',
          version: '1.0.0',
          sha256: 'cafebabe',
          composed_at: '2026-01-01T00:00:00.000Z',
          engine_version_at_compose: '0.1.0',
        },
      ],
      managed: [],
      known_failures: [],
      pin: null,
    };
    await writeFile(
      join(projectRoot, 'aidlc.lock.json'),
      JSON.stringify(lockfile, null, 2),
      'utf8',
    );
    return projectRoot;
  }

  /** Fake child covering both `runComposeCommand` (close-only) and `runDoctorCommand` (stdout + close) shapes. */
  class FakeChild extends EventEmitter {
    stdout = new EventEmitter();
  }

  function installSpawnMock(doctorStdout: string) {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spawnMock = mock((cmd: string, args: string[], _opts: unknown) => {
      calls.push({ cmd, args });
      const child = new FakeChild();
      queueMicrotask(() => {
        if (cmd === 'doctor-bin') {
          child.stdout.emit('data', Buffer.from(doctorStdout));
        }
        child.emit('close', 0);
      });
      return child;
    });
    mock.module('node:child_process', () => ({ spawn: spawnMock }));
    return { spawnMock, calls };
  }

  test('invokes the configured doctor command and folds its parsed failures into verification failure', async () => {
    const { calls } = installSpawnMock('missing plugin foo\nstale engine ref\n');
    const { buildRealDeps } = await import('./real-deps');
    const projectRoot = await makeProjectRoot();
    try {
      const deps = buildRealDeps({
        projectRoot,
        channelUrl: 'https://example.test/channel.json',
        composeCommand: ['compose-bin', '--compose'],
        doctorCommand: ['doctor-bin', '--json'],
      });

      const result = await deps.pluginManager.remove('example-plugin');

      // The doctor command was actually shelled out to (not skipped/stubbed).
      const doctorCalls = calls.filter((c) => c.cmd === 'doctor-bin');
      expect(doctorCalls).toHaveLength(1);
      expect(doctorCalls[0]!.args).toEqual(['--json']);
      // Its two reported failures flow through SuccessVerifier's BR3.1
      // third predicate and block the plugin-remove write.
      expect(result.success).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('a clean doctor run (no failures) lets an otherwise-clean remove succeed', async () => {
    const { calls } = installSpawnMock('');
    const { buildRealDeps } = await import('./real-deps');
    const projectRoot = await makeProjectRoot();
    try {
      const deps = buildRealDeps({
        projectRoot,
        channelUrl: 'https://example.test/channel.json',
        composeCommand: ['compose-bin'],
        doctorCommand: ['doctor-bin'],
      });

      const result = await deps.pluginManager.remove('example-plugin');

      const doctorCalls = calls.filter((c) => c.cmd === 'doctor-bin');
      expect(doctorCalls).toHaveLength(1);
      expect(result.success).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

/**
 * Coverage-floor follow-up (post code-review): the port closures above
 * are only half the story — `buildRealDeps().pluginManager.remove()`
 * never exercises `engineInstaller.install()`'s ports (`placeEngine`,
 * `checkEngineDirectoryReplace`, engine-side `loadLockfile`/`saveLockfile`),
 * `pluginManager.add()`'s own ports (`placeProjection`,
 * `regenerateSessionStartHook`), `lockfileStore.loadClassified()`'s three
 * branches, `installedState.read()`, `doctorRunner.run()`, or the
 * `stdout`/`stderr` writers. These tests drive each of those through the
 * real `buildRealDeps()` wiring (mocked `child_process.spawn` and
 * `fetch`, real temp-directory filesystem) so the 80% line-coverage floor
 * (`bunfig.toml`, team.md Testing Posture) is met by exercising the
 * actual production glue, not by lowering the bar.
 */
describe('buildRealDeps() — remaining port coverage', () => {
  async function makeEmptyProjectRoot(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'aidlc-fleet-real-deps-'));
  }

  class FakeChild extends EventEmitter {
    stdout = new EventEmitter();
  }

  /** Mocks `spawn` (compose + doctor, both closing 0 with no doctor findings) and `fetch` (returns `tarballBytes` for any URL). */
  function installEnvironmentMocks(tarballBytes: Uint8Array) {
    const spawnMock = mock((_cmd: string, _args: string[], _opts: unknown) => {
      const child = new FakeChild();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });
    mock.module('node:child_process', () => ({ spawn: spawnMock }));

    const originalFetch = globalThis.fetch;
    const fetchMock = mock(async (_url: string) => {
      return new Response(new Uint8Array(tarballBytes).buffer as ArrayBuffer, { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return {
      spawnMock,
      fetchMock,
      restoreFetch: () => {
        globalThis.fetch = originalFetch;
      },
    };
  }

  test('engineInstaller.install() drives placeEngine/checkEngineDirectoryReplace/runCompose/loadLockfile/saveLockfile end-to-end', async () => {
    const tarballBytes = buildTarGzFixture(
      'aidlc-workflows-engine-ref',
      'dist/claude/.claude/settings.json',
      '{}',
    );
    const sha256 = createHash('sha256').update(tarballBytes).digest('hex');
    const { fetchMock, spawnMock, restoreFetch } = installEnvironmentMocks(tarballBytes);
    const projectRoot = await makeEmptyProjectRoot();
    try {
      // checkEngineDirectoryReplace's backup step (BR2.1) copies the
      // existing engine-owned directory before replacing it, so it must
      // already exist even for this "first init" scenario.
      await mkdir(join(projectRoot, '.claude'), { recursive: true });
      const { buildRealDeps } = await import('./real-deps');
      const deps = buildRealDeps({
        projectRoot,
        channelUrl: 'https://example.test/channel.json',
        composeCommand: ['compose-bin'],
        doctorCommand: ['doctor-bin'],
        engineRepo: 'awslabs/aidlc-workflows',
      });

      const result = await deps.engineInstaller.install(
        { ref: 'engine-ref', version: '0.1.0', tag: null, sha256 },
        { harness: 'claude-code', force: true, isFirstInit: true, adopt: false },
      );

      expect(result.success).toBe(true);
      // The tarball was fetched from a real, resolvable URL built from
      // engineRepo + the engine ref — not the bare commit SHA passed
      // straight to fetch() (the bug this test now guards against).
      expect(fetchMock).toHaveBeenCalledWith(
        'https://codeload.github.com/awslabs/aidlc-workflows/tar.gz/engine-ref',
      );
      // placeEngine actually extracted the tarball (not just staged the
      // raw bytes) into the engine staging dir, stripping the GitHub
      // codeload wrapper directory.
      const extracted = await readFile(
        join(
          projectRoot,
          '.aidlc-fleet',
          'engine-src',
          'dist',
          'claude',
          '.claude',
          'settings.json',
        ),
        'utf8',
      );
      expect(extracted).toBe('{}');
      // runCompose points the configured compose command at the extracted tree.
      const composeCall = spawnMock.mock.calls.find(([cmd]) => cmd === 'compose-bin');
      const composeEnv = composeCall?.[2] as { env?: Record<string, string> } | undefined;
      expect(composeEnv?.env?.AIDLC_FLEET_ENGINE_SRC_DIR).toBe(
        join(projectRoot, '.aidlc-fleet', 'engine-src'),
      );
      // saveLockfile persisted the lockfile AND updated installed-state (engineRef).
      const lockfileRaw = await readFile(join(projectRoot, 'aidlc.lock.json'), 'utf8');
      expect(JSON.parse(lockfileRaw).engine.ref).toBe('engine-ref');
      const installedStateRaw = await readFile(
        join(projectRoot, '.aidlc-fleet-installed.json'),
        'utf8',
      );
      expect(JSON.parse(installedStateRaw).engineRef).toBe('engine-ref');
    } finally {
      restoreFetch();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('pluginManager.add() drives placeProjection/regenerateSessionStartHook end-to-end', async () => {
    const tarballBytes = buildTarGzFixture(
      'example-plugin-plugin-ref',
      'plugin.json',
      '{"ok":true}',
    );
    const sha256 = createHash('sha256').update(tarballBytes).digest('hex');
    const { fetchMock, restoreFetch } = installEnvironmentMocks(tarballBytes);
    const projectRoot = await makeEmptyProjectRoot();
    try {
      // Seed a Lockfile with no plugins yet (add() reads it before placing).
      await writeFile(
        join(projectRoot, 'aidlc.lock.json'),
        JSON.stringify({
          schema: 1,
          channel: 'stable',
          channel_commit: 'abc123',
          engine: {
            ref: 'engine-ref',
            version: '0.1.0',
            sha256: 'deadbeef',
            harness: 'claude-code',
            installed_at: '2026-01-01T00:00:00.000Z',
          },
          engine_origin: '0.1.0',
          plugins: [],
          managed: [],
          known_failures: [],
          pin: null,
        }),
        'utf8',
      );
      const { buildRealDeps } = await import('./real-deps');
      const deps = buildRealDeps({
        projectRoot,
        channelUrl: 'https://example.test/channel.json',
        composeCommand: ['compose-bin'],
        doctorCommand: ['doctor-bin'],
      });

      const result = await deps.pluginManager.add({
        name: 'example-plugin',
        repo: 'org/example-plugin',
        ref: 'plugin-ref',
        version: '1.0.0',
        sha256,
      });

      expect(result.success).toBe(true);
      // Fetched from a URL built out of plugin.repo + plugin.ref, not the
      // bare ref (the same bug class as the engine-side fix above).
      expect(fetchMock).toHaveBeenCalledWith(
        'https://codeload.github.com/org/example-plugin/tar.gz/plugin-ref',
      );
      const projection = await readFile(
        join(projectRoot, '.claude', 'plugins', 'example-plugin', 'plugin.json'),
        'utf8',
      );
      expect(projection).toBe('{"ok":true}');
      const hook = await readFile(
        join(projectRoot, '.claude', 'hooks', 'session-start.sh'),
        'utf8',
      );
      expect(hook).toContain('BEGIN example-plugin');
      const installedStateRaw = await readFile(
        join(projectRoot, '.aidlc-fleet-installed.json'),
        'utf8',
      );
      expect(JSON.parse(installedStateRaw).pluginRefs['example-plugin']).toBe('plugin-ref');
    } finally {
      restoreFetch();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('lockfileStore.loadClassified() reports "absent" when no Lockfile exists', async () => {
    const projectRoot = await makeEmptyProjectRoot();
    try {
      const { buildRealDeps } = await import('./real-deps');
      const deps = buildRealDeps({
        projectRoot,
        channelUrl: 'https://example.test/channel.json',
        composeCommand: ['compose-bin'],
      });
      const loaded = await deps.lockfileStore.loadClassified();
      expect(loaded.state).toBe('absent');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('lockfileStore.loadClassified() reports "malformed" on invalid JSON', async () => {
    const projectRoot = await makeEmptyProjectRoot();
    try {
      await writeFile(join(projectRoot, 'aidlc.lock.json'), '{ not valid json', 'utf8');
      const { buildRealDeps } = await import('./real-deps');
      const deps = buildRealDeps({
        projectRoot,
        channelUrl: 'https://example.test/channel.json',
        composeCommand: ['compose-bin'],
      });
      const loaded = await deps.lockfileStore.loadClassified();
      expect(loaded.state).toBe('malformed');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('lockfileStore.loadClassified() reports "present" with the parsed Lockfile when one exists', async () => {
    const projectRoot = await makeEmptyProjectRoot();
    try {
      await writeFile(
        join(projectRoot, 'aidlc.lock.json'),
        JSON.stringify({
          schema: 1,
          channel: 'stable',
          channel_commit: 'abc123',
          engine: {
            ref: 'engine-ref',
            version: '0.1.0',
            sha256: 'deadbeef',
            harness: 'claude-code',
            installed_at: '2026-01-01T00:00:00.000Z',
          },
          engine_origin: '0.1.0',
          plugins: [],
          managed: [],
          known_failures: [],
          pin: null,
        }),
        'utf8',
      );
      const { buildRealDeps } = await import('./real-deps');
      const deps = buildRealDeps({
        projectRoot,
        channelUrl: 'https://example.test/channel.json',
        composeCommand: ['compose-bin'],
      });
      const loaded = await deps.lockfileStore.loadClassified();
      expect(loaded.state).toBe('present');
      if (loaded.state === 'present') {
        expect(loaded.lockfile.channel).toBe('stable');
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('installedState.read() reflects the on-disk installed-state marker', async () => {
    const projectRoot = await makeEmptyProjectRoot();
    try {
      await writeFile(
        join(projectRoot, '.aidlc-fleet-installed.json'),
        JSON.stringify({ engineRef: 'engine-ref', pluginRefs: { foo: 'foo-ref' } }),
        'utf8',
      );
      const { buildRealDeps } = await import('./real-deps');
      const deps = buildRealDeps({
        projectRoot,
        channelUrl: 'https://example.test/channel.json',
        composeCommand: ['compose-bin'],
      });
      const state = await deps.installedState.read();
      expect(state.installedEngineRef).toBe('engine-ref');
      expect(state.installedPluginRefs).toEqual({ foo: 'foo-ref' });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('doctorRunner.run() shells out to the configured doctor command', async () => {
    class DoctorChild extends EventEmitter {
      stdout = new EventEmitter();
    }
    const child = new DoctorChild();
    const spawnMock = mock((_cmd: string, _args: string[], _opts: unknown) => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('missing plugin foo\n'));
        child.emit('close', 0);
      });
      return child;
    });
    mock.module('node:child_process', () => ({ spawn: spawnMock }));
    const projectRoot = await makeEmptyProjectRoot();
    try {
      const { buildRealDeps } = await import('./real-deps');
      const deps = buildRealDeps({
        projectRoot,
        channelUrl: 'https://example.test/channel.json',
        composeCommand: ['compose-bin'],
        doctorCommand: ['doctor-bin'],
      });
      const result = await deps.doctorRunner.run();
      expect(result.failures).toEqual(['missing plugin foo']);
      expect(spawnMock).toHaveBeenCalledTimes(1);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('stdout/stderr write to the real process streams', async () => {
    const projectRoot = await makeEmptyProjectRoot();
    try {
      const { buildRealDeps } = await import('./real-deps');
      const deps = buildRealDeps({
        projectRoot,
        channelUrl: 'https://example.test/channel.json',
        composeCommand: ['compose-bin'],
      });
      const stdoutSpy = mock(() => true);
      const stderrSpy = mock(() => true);
      const originalStdoutWrite = process.stdout.write.bind(process.stdout);
      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      process.stdout.write = stdoutSpy as unknown as typeof process.stdout.write;
      process.stderr.write = stderrSpy as unknown as typeof process.stderr.write;
      try {
        deps.stdout('hello');
        deps.stderr('oops');
        expect(stdoutSpy).toHaveBeenCalledWith('hello\n');
        expect(stderrSpy).toHaveBeenCalledWith('oops\n');
      } finally {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
