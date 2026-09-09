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
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    await writeFile(join(projectRoot, 'aidlc.lock.json'), JSON.stringify(lockfile, null, 2), 'utf8');
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
