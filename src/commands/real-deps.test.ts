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
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { assertDefined } from '../test-support/assert-defined';

const TAR_BLOCK_SIZE = 512;

/**
 * ustar ヘッダー（512バイト）を1件手組みするテスト用ヘルパー。
 * `src/io/tar-extract.test.ts` の同名ヘルパーと同じ設計方針
 * （unit-test-instructions.md「Test Data Management」: バイナリ
 * フィクスチャファイルは追加せず、テストコード内で動的生成する）。
 */
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

/** ラッパーディレクトリ付き gzip tarball（GitHub codeload 規約）をテスト用に生成する。 */
function buildPluginGzipTarball(
  entries: Array<{ name: string; typeflag: string; content?: string }>,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    const content = entry.content ?? '';
    const contentBytes = new TextEncoder().encode(content);
    chunks.push(buildTarHeader(entry.name, contentBytes.length, entry.typeflag));
    if (contentBytes.length > 0) {
      const padded = new Uint8Array(
        Math.ceil(contentBytes.length / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE,
      );
      padded.set(contentBytes);
      chunks.push(padded);
    }
  }
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

/**
 * issue #6: 書き込み先が `.claude` にハードコードされており、他ハーネスへ
 * 配布できないバグの修正。`resolveHarnessRoot` は upstream の
 * `.claude/tools/data/plugin-targets.json`（7ハーネス分の `harnessLeaf`
 * 定義）を静的 JSON import で参照し、fleet 側で置き場所マッピングを
 * 再定義しない（完了条件2）。未知の harness は `.claude` へフォール
 * バックせず明示的に失敗する（完了条件3）。
 */
describe('resolveHarnessRoot', () => {
  test('resolves the "claude" harness key to ".claude" (plugin-targets.json harnessLeaf)', async () => {
    const { resolveHarnessRoot } = await import('./real-deps');
    expect(resolveHarnessRoot('claude')).toBe('.claude');
  });

  test('resolves a second, distinct harness key ("cursor") to ".cursor"', async () => {
    const { resolveHarnessRoot } = await import('./real-deps');
    expect(resolveHarnessRoot('cursor')).toBe('.cursor');
  });

  test('throws an explicit error for an unrecognized harness value (no .claude fallback)', async () => {
    const { resolveHarnessRoot } = await import('./real-deps');
    expect(() => resolveHarnessRoot('bogus-harness')).toThrow(/bogus-harness/);
  });

  test('throws for an inherited Object.prototype key instead of resolving it as a harness (no prototype-pollution-style bypass)', async () => {
    const { resolveHarnessRoot } = await import('./real-deps');
    expect(() => resolveHarnessRoot('toString')).toThrow(/toString/);
    expect(() => resolveHarnessRoot('constructor')).toThrow(/constructor/);
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
    const [cmd, args] = assertDefined(spawnMock.mock.calls[0]);
    expect(cmd).toBe('doctor-bin');
    expect(args).toEqual(['--json']);
  });

  /**
   * code-review finding: `runDoctorCommand` only ever parsed stdout and
   * never inspected the child's exit code, so a doctor command that
   * exits non-zero with nothing on stdout (crash, bad path, permission
   * error) was reported as `{ failures: [] }` — "no unaddressed
   * failures" — indistinguishable from a genuinely clean run. This
   * exposure grew with issue #18's built-in `AIDLC_FLEET_DOCTOR_CMD`
   * default, which makes doctor actually invoke a real command by
   * default rather than only on explicit opt-in.
   */
  test('a non-zero exit with no stdout output is reported as a failure, not silently swallowed', async () => {
    class FakeChild extends EventEmitter {
      stdout = new EventEmitter();
    }
    const child = new FakeChild();
    const spawnMock = mock((_cmd: string, _args: string[], _opts: unknown) => {
      queueMicrotask(() => {
        child.emit('close', 1);
      });
      return child;
    });
    mock.module('node:child_process', () => ({ spawn: spawnMock }));
    const { runDoctorCommand } = await import('./real-deps');

    const result = await runDoctorCommand(['doctor-bin'], {});
    expect(result.failures.length).toBeGreaterThan(0);
  });

  test('a zero exit with reported stdout failures is unaffected by the exit-code check', async () => {
    class FakeChild extends EventEmitter {
      stdout = new EventEmitter();
    }
    const child = new FakeChild();
    const spawnMock = mock((_cmd: string, _args: string[], _opts: unknown) => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('missing plugin foo\n'));
        child.emit('close', 0);
      });
      return child;
    });
    mock.module('node:child_process', () => ({ spawn: spawnMock }));
    const { runDoctorCommand } = await import('./real-deps');

    const result = await runDoctorCommand(['doctor-bin'], {});
    expect(result.failures).toEqual(['missing plugin foo']);
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
        harness: 'claude',
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
      expect(doctorCalls[0]?.args).toEqual(['--json']);
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
    const tarballBytes = new TextEncoder().encode('engine-tarball-bytes');
    const sha256 = createHash('sha256').update(tarballBytes).digest('hex');
    const { fetchMock, restoreFetch } = installEnvironmentMocks(tarballBytes);
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
        { harness: 'claude', force: true, isFirstInit: true, adopt: false },
      );

      expect(result.success).toBe(true);
      // The tarball was fetched from a real, resolvable URL built from
      // engineRepo + the engine ref — not the bare commit SHA passed
      // straight to fetch() (the bug this test now guards against).
      expect(fetchMock).toHaveBeenCalledWith(
        'https://codeload.github.com/awslabs/aidlc-workflows/tar.gz/engine-ref',
      );
      // placeEngine wrote the staged tarball bytes.
      const staged = await readFile(join(projectRoot, '.claude', '.engine-claude.tar'));
      expect(new Uint8Array(staged)).toEqual(tarballBytes);
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

  /**
   * issue #5: このテストはかつて「`placeProjection` が生バイト列を
   * `.projection.tar` にそのまま書き出す」という旧・バグ挙動を green
   * にしていた（アサーションが `.projection.tar` の中身が生バイト列と
   * 一致することを確認していた）。修正後は実際に tarball が展開され、
   * ラッパーディレクトリが除去されたファイルツリーが
   * `.claude/plugins/<name>/` 配下に実在することを検証する
   * （FR1.1〜FR1.4, code-generation-plan.md Step 11）。
   */
  test('pluginManager.add() drives placeProjection/regenerateSessionStartHook end-to-end (実際に tarball を展開する)', async () => {
    const tarballBytes = buildPluginGzipTarball([
      { name: 'example-plugin-plugin-ref/', typeflag: '5' },
      {
        name: 'example-plugin-plugin-ref/claude-code-plugin/plugin.json',
        typeflag: '0',
        content: '{"name":"example-plugin"}',
      },
    ]);
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
            harness: 'claude',
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
      // The tarball is now actually EXTRACTED (issue #5 fix): no more raw
      // `.projection.tar` bytes — a real, readable file tree exists, with
      // the GitHub codeload wrapper directory stripped (FR1.3).
      const pluginJson = await readFile(
        join(
          projectRoot,
          '.claude',
          'plugins',
          'example-plugin',
          'claude-code-plugin',
          'plugin.json',
        ),
        'utf8',
      );
      expect(pluginJson).toBe('{"name":"example-plugin"}');
      const projectionDirEntries = await readdir(
        join(projectRoot, '.claude', 'plugins', 'example-plugin'),
      );
      expect(projectionDirEntries).not.toContain('.projection.tar');
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

  /**
   * issue #5 Step 12（team.md Mandated 実ファイルシステム統合テスト、
   * NFR4）: バージョン更新シナリオ — `removeProjection` が旧ファイルを
   * 完全に削除してから新ファイルが配置されることを実ファイルシステムで
   * 検証する（FR2.1, FR2.2）。
   */
  test('pluginManager.add() を異なる内容の tarball で2回実行すると、旧ファイルが完全に削除されてから新ファイルが配置される（FR2.1, FR2.2）', async () => {
    const firstTarball = buildPluginGzipTarball([
      { name: 'example-plugin-ref1/', typeflag: '5' },
      { name: 'example-plugin-ref1/old-only.txt', typeflag: '0', content: 'v1 content' },
    ]);
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
            harness: 'claude',
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

      // 1回目: v1 を配置する。
      {
        const sha256 = createHash('sha256').update(firstTarball).digest('hex');
        const { restoreFetch } = installEnvironmentMocks(firstTarball);
        try {
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
            ref: 'ref1',
            version: '1.0.0',
            sha256,
          });
          expect(result.success).toBe(true);
        } finally {
          restoreFetch();
        }
      }
      const oldFile = await readFile(
        join(projectRoot, '.claude', 'plugins', 'example-plugin', 'old-only.txt'),
        'utf8',
      );
      expect(oldFile).toBe('v1 content');

      // 2回目: 異なる内容の v2 を、既存プラグインがある状態で配置する。
      const secondTarball = buildPluginGzipTarball([
        { name: 'example-plugin-ref2/', typeflag: '5' },
        { name: 'example-plugin-ref2/new-only.txt', typeflag: '0', content: 'v2 content' },
      ]);
      {
        const sha256 = createHash('sha256').update(secondTarball).digest('hex');
        const { restoreFetch } = installEnvironmentMocks(secondTarball);
        try {
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
            ref: 'ref2',
            version: '2.0.0',
            sha256,
          });
          expect(result.success).toBe(true);
        } finally {
          restoreFetch();
        }
      }

      // 旧ファイルは完全に削除され、新ファイルのみが存在する。
      const finalEntries = await readdir(join(projectRoot, '.claude', 'plugins', 'example-plugin'));
      expect(finalEntries).toEqual(['new-only.txt']);
      const newFile = await readFile(
        join(projectRoot, '.claude', 'plugins', 'example-plugin', 'new-only.txt'),
        'utf8',
      );
      expect(newFile).toBe('v2 content');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  /**
   * CodeRabbit review (PR #7, issue #5) — two related atomicity gaps:
   * (1) `extractTarGz` writing directly into the live plugin directory
   * could leave a partial tree if an entry conflicts with one already
   * written (e.g. a file `a` followed by an entry needing `a` to be a
   * directory); (2) `PluginManager.add()` used to remove the old
   * projection before validating the new one, so a mid-extraction
   * failure lost a working old version entirely. Fix: `placeProjection`
   * extracts fully into a staging directory first and only swaps it into
   * the live location once extraction succeeds completely (real-deps.ts).
   * This test drives that against the real filesystem: an existing,
   * working v1 projection, an `add()` with a tarball whose entries
   * conflict on disk (so extraction fails partway through), and asserts
   * the old v1 tree is completely untouched afterward and no staging
   * directory is left behind.
   */
  test('add() で展開に失敗するアーカイブを渡しても、既存プラグインは変更されず、ステージングディレクトリも残らない（BR4.1 atomic placement）', async () => {
    const goodTarball = buildPluginGzipTarball([
      { name: 'example-plugin-ref1/', typeflag: '5' },
      { name: 'example-plugin-ref1/keep.txt', typeflag: '0', content: 'v1 content' },
    ]);
    // Conflicting entries: `a` is written as a plain file, then a later
    // entry needs `a` to be a directory (`a/b`) — `mkdir('a', {recursive:
    // true})` throws ENOTDIR because `a` already exists as a file, so
    // extraction fails after partially writing into the staging dir.
    const conflictingTarball = buildPluginGzipTarball([
      { name: 'example-plugin-ref2/', typeflag: '5' },
      { name: 'example-plugin-ref2/a', typeflag: '0', content: 'x' },
      { name: 'example-plugin-ref2/a/b', typeflag: '0', content: 'y' },
    ]);
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
            harness: 'claude',
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

      // 1回目: v1 を正常に配置する。
      {
        const sha256 = createHash('sha256').update(goodTarball).digest('hex');
        const { restoreFetch } = installEnvironmentMocks(goodTarball);
        try {
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
            ref: 'ref1',
            version: '1.0.0',
            sha256,
          });
          expect(result.success).toBe(true);
        } finally {
          restoreFetch();
        }
      }

      // 2回目: 競合するアーカイブで add() を実行し、失敗することを確認する。
      {
        const sha256 = createHash('sha256').update(conflictingTarball).digest('hex');
        const { restoreFetch } = installEnvironmentMocks(conflictingTarball);
        try {
          const { buildRealDeps } = await import('./real-deps');
          const deps = buildRealDeps({
            projectRoot,
            channelUrl: 'https://example.test/channel.json',
            composeCommand: ['compose-bin'],
            doctorCommand: ['doctor-bin'],
          });
          await expect(
            deps.pluginManager.add({
              name: 'example-plugin',
              repo: 'org/example-plugin',
              ref: 'ref2',
              version: '2.0.0',
              sha256,
            }),
          ).rejects.toThrow();
        } finally {
          restoreFetch();
        }
      }

      // 旧バージョン（v1）が完全に無傷で残っている。
      const survivingEntries = await readdir(
        join(projectRoot, '.claude', 'plugins', 'example-plugin'),
      );
      expect(survivingEntries).toEqual(['keep.txt']);
      const survivingFile = await readFile(
        join(projectRoot, '.claude', 'plugins', 'example-plugin', 'keep.txt'),
        'utf8',
      );
      expect(survivingFile).toBe('v1 content');

      // ステージングディレクトリが残っていない。
      const pluginsDirEntries = await readdir(join(projectRoot, '.claude', 'plugins'));
      expect(pluginsDirEntries).toEqual(['example-plugin']);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  /**
   * issue #5 Step 12（team.md Mandated 実ファイルシステム統合テスト、
   * NFR4）: パス整合性シナリオ — `.claude/plugins/<name>` を事前に
   * シンボリックリンクとして作成した状態で `add()` を実行し、
   * `FileOwnershipGuard` が実際の書き込み先に対してシンボリックリンク
   * 違反を検出して拒否することを検証する（FR3.2, FR3.3 — 修正前は
   * `pluginDirLabel()` が `plugins/<name>` を返し、`projectRoot` と合成
   * すると `<projectRoot>/plugins/<name>` という誤ったパスを検査して
   * いたため、この違反を検出できなかった）。
   */
  test('.claude/plugins/<name> がシンボリックリンクの場合、add() は FileOwnershipViolation で拒否する（FR3.2, FR3.3）', async () => {
    const tarballBytes = buildPluginGzipTarball([
      { name: 'example-plugin-plugin-ref/', typeflag: '5' },
      { name: 'example-plugin-plugin-ref/plugin.json', typeflag: '0', content: '{}' },
    ]);
    const sha256 = createHash('sha256').update(tarballBytes).digest('hex');
    const { restoreFetch } = installEnvironmentMocks(tarballBytes);
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
            harness: 'claude',
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

      // 攻撃/事故シナリオを再現: 展開先そのものが、プロジェクト外の
      // 実ディレクトリへのシンボリックリンクとして事前に存在する。
      const outsideTarget = await mkdtemp(join(tmpdir(), 'aidlc-fleet-symlink-target-'));
      await mkdir(join(projectRoot, '.claude', 'plugins'), { recursive: true });
      await symlink(
        outsideTarget,
        join(projectRoot, '.claude', 'plugins', 'example-plugin'),
        'dir',
      );

      const { buildRealDeps } = await import('./real-deps');
      const deps = buildRealDeps({
        projectRoot,
        channelUrl: 'https://example.test/channel.json',
        composeCommand: ['compose-bin'],
        doctorCommand: ['doctor-bin'],
      });

      await expect(
        deps.pluginManager.add({
          name: 'example-plugin',
          repo: 'org/example-plugin',
          ref: 'plugin-ref',
          version: '1.0.0',
          sha256,
        }),
      ).rejects.toThrow(/symlink/);

      // シンボリックリンクの向こう側には何も書き込まれていない。
      const outsideEntries = await readdir(outsideTarget);
      expect(outsideEntries).toEqual([]);
      await rm(outsideTarget, { recursive: true, force: true });
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
            harness: 'claude',
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

  /**
   * issue #6 完了条件4: 2種類以上の harness を指定した統合テストで、それ
   * ぞれ正しいディレクトリに配置されることを検証する。5箇所のハードコード
   * （checkEngineDirectoryReplace, placeEngine, checkWriteAllowed,
   * removeProjection, placeProjection, regenerateSessionStartHook）を
   * `harness: 'cursor'` で駆動し、`.claude/` ではなく `.cursor/` 配下に
   * 配置されることを real filesystem 上で確認する。
   */
  describe('issue #6: harness write-target resolution', () => {
    function cursorLockfileJson(overrides: { plugins?: unknown[] } = {}) {
      return JSON.stringify({
        schema: 1,
        channel: 'stable',
        channel_commit: 'abc123',
        engine: {
          ref: 'engine-ref',
          version: '0.1.0',
          sha256: 'deadbeef',
          harness: 'cursor',
          installed_at: '2026-01-01T00:00:00.000Z',
        },
        engine_origin: '0.1.0',
        plugins: overrides.plugins ?? [],
        managed: [],
        known_failures: [],
        pin: null,
      });
    }

    test('engineInstaller.install() with harness "cursor" places the engine under .cursor/, not .claude/', async () => {
      const tarballBytes = new TextEncoder().encode('engine-tarball-bytes');
      const sha256 = createHash('sha256').update(tarballBytes).digest('hex');
      const { restoreFetch } = installEnvironmentMocks(tarballBytes);
      const projectRoot = await makeEmptyProjectRoot();
      try {
        await mkdir(join(projectRoot, '.cursor'), { recursive: true });
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
          { harness: 'cursor', force: true, isFirstInit: true, adopt: false },
        );

        expect(result.success).toBe(true);
        const staged = await readFile(join(projectRoot, '.cursor', '.engine-cursor.tar'));
        expect(new Uint8Array(staged)).toEqual(tarballBytes);
        // .claude/ must not be touched by a cursor-targeted install.
        await expect(
          readFile(join(projectRoot, '.claude', '.engine-cursor.tar')),
        ).rejects.toThrow();
      } finally {
        restoreFetch();
        await rm(projectRoot, { recursive: true, force: true });
      }
    });

    test('pluginManager.add() with lockfile engine.harness "cursor" places the plugin projection and session-start hook under .cursor/', async () => {
      const tarballBytes = buildPluginGzipTarball([
        { name: 'example-plugin-plugin-ref/', typeflag: '5' },
        {
          name: 'example-plugin-plugin-ref/plugin.json',
          typeflag: '0',
          content: '{"name":"example-plugin"}',
        },
      ]);
      const sha256 = createHash('sha256').update(tarballBytes).digest('hex');
      const { fetchMock, restoreFetch } = installEnvironmentMocks(tarballBytes);
      const projectRoot = await makeEmptyProjectRoot();
      try {
        await writeFile(join(projectRoot, 'aidlc.lock.json'), cursorLockfileJson(), 'utf8');
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
        expect(fetchMock).toHaveBeenCalledWith(
          'https://codeload.github.com/org/example-plugin/tar.gz/plugin-ref',
        );
        const pluginJson = await readFile(
          join(projectRoot, '.cursor', 'plugins', 'example-plugin', 'plugin.json'),
          'utf8',
        );
        expect(pluginJson).toBe('{"name":"example-plugin"}');
        const hook = await readFile(
          join(projectRoot, '.cursor', 'hooks', 'session-start.sh'),
          'utf8',
        );
        expect(hook).toContain('BEGIN example-plugin');
        // .claude/ must not be touched by a cursor-targeted add().
        await expect(readdir(join(projectRoot, '.claude'))).rejects.toThrow();
      } finally {
        restoreFetch();
        await rm(projectRoot, { recursive: true, force: true });
      }
    });

    test("pluginManager.remove() with lockfile engine.harness 'cursor' removes from .cursor/plugins/<name>", async () => {
      const tarballBytes = buildPluginGzipTarball([
        { name: 'example-plugin-plugin-ref/', typeflag: '5' },
        { name: 'example-plugin-plugin-ref/plugin.json', typeflag: '0', content: '{}' },
      ]);
      const sha256 = createHash('sha256').update(tarballBytes).digest('hex');
      const { restoreFetch } = installEnvironmentMocks(tarballBytes);
      const projectRoot = await makeEmptyProjectRoot();
      try {
        await writeFile(
          join(projectRoot, 'aidlc.lock.json'),
          cursorLockfileJson({
            plugins: [
              {
                name: 'example-plugin',
                ref: 'plugin-ref',
                version: '1.0.0',
                sha256,
                composed_at: '2026-01-01T00:00:00.000Z',
                engine_version_at_compose: '0.1.0',
              },
            ],
          }),
          'utf8',
        );
        await mkdir(join(projectRoot, '.cursor', 'plugins', 'example-plugin'), {
          recursive: true,
        });
        await writeFile(
          join(projectRoot, '.cursor', 'plugins', 'example-plugin', 'plugin.json'),
          '{}',
          'utf8',
        );
        // A sentinel under `.claude/` proves remove() with a cursor-targeted
        // lockfile never touches the unrelated `.claude/` tree (the
        // "`.claude/` untouched" contract this describe block's other tests
        // already assert for install()/add()).
        await mkdir(join(projectRoot, '.claude', 'plugins', 'example-plugin'), {
          recursive: true,
        });
        await writeFile(
          join(projectRoot, '.claude', 'plugins', 'example-plugin', 'sentinel'),
          'untouched',
          'utf8',
        );

        const { buildRealDeps } = await import('./real-deps');
        const deps = buildRealDeps({
          projectRoot,
          channelUrl: 'https://example.test/channel.json',
          composeCommand: ['compose-bin'],
          doctorCommand: ['doctor-bin'],
        });

        const result = await deps.pluginManager.remove('example-plugin');
        expect(result.success).toBe(true);

        await expect(
          readdir(join(projectRoot, '.cursor', 'plugins', 'example-plugin')),
        ).rejects.toThrow();
        const sentinel = await readFile(
          join(projectRoot, '.claude', 'plugins', 'example-plugin', 'sentinel'),
          'utf8',
        );
        expect(sentinel).toBe('untouched');
      } finally {
        restoreFetch();
        await rm(projectRoot, { recursive: true, force: true });
      }
    });

    test('engineInstaller.install() with an unknown harness value rejects explicitly and writes nothing under any dot-directory', async () => {
      const tarballBytes = new TextEncoder().encode('engine-tarball-bytes');
      const sha256 = createHash('sha256').update(tarballBytes).digest('hex');
      const { restoreFetch } = installEnvironmentMocks(tarballBytes);
      const projectRoot = await makeEmptyProjectRoot();
      try {
        const { buildRealDeps } = await import('./real-deps');
        const deps = buildRealDeps({
          projectRoot,
          channelUrl: 'https://example.test/channel.json',
          composeCommand: ['compose-bin'],
          doctorCommand: ['doctor-bin'],
          engineRepo: 'awslabs/aidlc-workflows',
        });

        await expect(
          deps.engineInstaller.install(
            { ref: 'engine-ref', version: '0.1.0', tag: null, sha256 },
            { harness: 'bogus-harness', force: true, isFirstInit: true, adopt: false },
          ),
        ).rejects.toThrow(/bogus-harness/);

        const entries = await readdir(projectRoot);
        expect(entries.filter((e) => e.startsWith('.'))).toEqual([]);
      } finally {
        restoreFetch();
        await rm(projectRoot, { recursive: true, force: true });
      }
    });

    test('pluginManager.add() with an unknown harness value in the seeded lockfile rejects explicitly and writes nothing', async () => {
      const tarballBytes = buildPluginGzipTarball([
        { name: 'example-plugin-plugin-ref/', typeflag: '5' },
        { name: 'example-plugin-plugin-ref/plugin.json', typeflag: '0', content: '{}' },
      ]);
      const sha256 = createHash('sha256').update(tarballBytes).digest('hex');
      const { restoreFetch } = installEnvironmentMocks(tarballBytes);
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
              harness: 'bogus-harness',
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

        await expect(
          deps.pluginManager.add({
            name: 'example-plugin',
            repo: 'org/example-plugin',
            ref: 'plugin-ref',
            version: '1.0.0',
            sha256,
          }),
        ).rejects.toThrow(/bogus-harness/);

        const entries = await readdir(projectRoot);
        expect(entries.filter((e) => e.startsWith('.') && e !== '.' && e !== '..')).toEqual([]);
      } finally {
        restoreFetch();
        await rm(projectRoot, { recursive: true, force: true });
      }
    });
  });

  test('issue #18: buildConfigAccess().resolveAll() resolves env > local-config > default > unset against the real filesystem', async () => {
    const projectRoot = await makeEmptyProjectRoot();
    const originalChannelUrl = process.env.AIDLC_FLEET_CHANNEL_URL;
    const originalEngineRepo = process.env.AIDLC_FLEET_ENGINE_REPO;
    try {
      process.env.AIDLC_FLEET_CHANNEL_URL = undefined;
      process.env.AIDLC_FLEET_ENGINE_REPO = 'env-owner/env-repo';
      await writeFile(
        join(projectRoot, '.aidlc-fleet.local.json'),
        JSON.stringify({ AIDLC_FLEET_CHANNEL_URL: 'http://local.example/channel.json' }),
        'utf8',
      );
      const { buildConfigAccess } = await import('./real-deps');
      const resolved = await buildConfigAccess(projectRoot).resolveAll();
      expect(resolved.AIDLC_FLEET_CHANNEL_URL).toEqual({
        value: 'http://local.example/channel.json',
        source: 'local-config',
      });
      expect(resolved.AIDLC_FLEET_ENGINE_REPO).toEqual({
        value: 'env-owner/env-repo',
        source: 'env',
      });
      expect(resolved.AIDLC_FLEET_COMPOSE_CMD.source).toBe('default');
      expect(resolved.AIDLC_FLEET_DOCTOR_CMD.source).toBe('default');
    } finally {
      if (originalChannelUrl === undefined) process.env.AIDLC_FLEET_CHANNEL_URL = undefined;
      else process.env.AIDLC_FLEET_CHANNEL_URL = originalChannelUrl;
      if (originalEngineRepo === undefined) process.env.AIDLC_FLEET_ENGINE_REPO = undefined;
      else process.env.AIDLC_FLEET_ENGINE_REPO = originalEngineRepo;
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('issue #18: buildConfigAccess().saveLocal() persists to .aidlc-fleet.local.json under projectRoot, merging with existing entries', async () => {
    const projectRoot = await makeEmptyProjectRoot();
    try {
      const { buildConfigAccess } = await import('./real-deps');
      const configAccess = buildConfigAccess(projectRoot);
      await configAccess.saveLocal({
        AIDLC_FLEET_CHANNEL_URL: 'http://first.example/channel.json',
      });
      await configAccess.saveLocal({ AIDLC_FLEET_ENGINE_REPO: 'someone/fork' });
      const raw = await readFile(join(projectRoot, '.aidlc-fleet.local.json'), 'utf8');
      expect(JSON.parse(raw)).toEqual({
        AIDLC_FLEET_CHANNEL_URL: 'http://first.example/channel.json',
        AIDLC_FLEET_ENGINE_REPO: 'someone/fork',
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test('issue #18: buildConfigAccess().prompt() reads one line from the injected readline interface', async () => {
    const questionMock = mock(async (_q: string) => 'typed-answer');
    const closeMock = mock(() => undefined);
    mock.module('node:readline/promises', () => ({
      createInterface: () => ({ question: questionMock, close: closeMock }),
    }));
    const { buildConfigAccess } = await import('./real-deps');
    const projectRoot = await makeEmptyProjectRoot();
    try {
      const answer = await buildConfigAccess(projectRoot).prompt('Enter value: ');
      expect(answer).toBe('typed-answer');
      expect(questionMock).toHaveBeenCalledWith('Enter value: ');
      expect(closeMock).toHaveBeenCalledTimes(1);
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
