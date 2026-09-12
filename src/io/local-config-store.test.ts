import { test, expect, describe, afterEach } from 'bun:test';
import { mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalConfigStore, LocalConfigMalformedError } from './local-config-store';

/**
 * Real-filesystem integration tests (temp dir, no mocks) — team.md's
 * mandate for file-ownership-adjacent I/O: "実ファイルシステムに対する
 * 統合テスト...を必須とする".
 */
describe('LocalConfigStore (I/O layer)', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'aidlc-fleet-local-config-'));
    dirs.push(dir);
    return dir;
  }

  test('load() returns an empty object when the file is absent', async () => {
    const dir = await makeTempDir();
    const store = new LocalConfigStore(dir);
    const values = await store.load();
    expect(values).toEqual({});
  });

  test('load() parses a valid file and returns its recognised keys', async () => {
    const dir = await makeTempDir();
    await writeFile(
      join(dir, '.aidlc-fleet.local.json'),
      JSON.stringify({ AIDLC_FLEET_CHANNEL_URL: 'http://local.example/channel.json' }),
      'utf8',
    );
    const store = new LocalConfigStore(dir);
    const values = await store.load();
    expect(values).toEqual({ AIDLC_FLEET_CHANNEL_URL: 'http://local.example/channel.json' });
  });

  test('load() throws LocalConfigMalformedError on invalid JSON', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, '.aidlc-fleet.local.json'), '{not json', 'utf8');
    const store = new LocalConfigStore(dir);
    await expect(store.load()).rejects.toBeInstanceOf(LocalConfigMalformedError);
  });

  test('save() then load() round-trips the recognised keys', async () => {
    const dir = await makeTempDir();
    const store = new LocalConfigStore(dir);
    await store.save({
      AIDLC_FLEET_CHANNEL_URL: 'http://local.example/channel.json',
      AIDLC_FLEET_ENGINE_REPO: 'someone/fork',
    });
    const values = await store.load();
    expect(values).toEqual({
      AIDLC_FLEET_CHANNEL_URL: 'http://local.example/channel.json',
      AIDLC_FLEET_ENGINE_REPO: 'someone/fork',
    });
  });

  test('merge() preserves existing keys not present in the partial update', async () => {
    const dir = await makeTempDir();
    const store = new LocalConfigStore(dir);
    await store.save({ AIDLC_FLEET_CHANNEL_URL: 'http://local.example/channel.json' });
    const merged = await store.merge({ AIDLC_FLEET_ENGINE_REPO: 'someone/fork' });
    expect(merged).toEqual({
      AIDLC_FLEET_CHANNEL_URL: 'http://local.example/channel.json',
      AIDLC_FLEET_ENGINE_REPO: 'someone/fork',
    });
    expect(await store.load()).toEqual(merged);
  });

  /**
   * code-review finding: save() used a plain `writeFile(this.path, ...)`,
   * which FOLLOWS an existing symlink at that path and writes through it
   * instead of replacing it — the same class of issue
   * `FileOwnershipGuard`/`extractTarGz` exist to prevent for engine-owned
   * paths. `.aidlc-fleet.local.json` is CLI-owned, not guarded by
   * `FileOwnershipGuard`, so this store must not follow a symlink there
   * itself. Fix: write to a fresh, exclusively-created temp file, then
   * `rename()` over the destination — rename replaces the directory entry
   * without following a symlink there (the same pattern `LockfileStore`
   * and `PluginManager.placeProjection` already use).
   */
  test('save() replaces an existing symlink at the destination instead of writing through it', async () => {
    const dir = await makeTempDir();
    const outsideTarget = await mkdtemp(join(tmpdir(), 'aidlc-fleet-local-config-symlink-target-'));
    try {
      await writeFile(join(outsideTarget, 'sentinel.json'), '{}', 'utf8');
      await symlink(
        join(outsideTarget, 'sentinel.json'),
        join(dir, '.aidlc-fleet.local.json'),
        'file',
      );
      const store = new LocalConfigStore(dir);
      await store.save({ AIDLC_FLEET_CHANNEL_URL: 'http://local.example/channel.json' });

      // The symlink target itself was never written to.
      const targetContent = await readFile(join(outsideTarget, 'sentinel.json'), 'utf8');
      expect(targetContent).toBe('{}');
      // The destination is now a plain file (the symlink was replaced, not followed).
      const written = await readFile(join(dir, '.aidlc-fleet.local.json'), 'utf8');
      expect(JSON.parse(written)).toEqual({
        AIDLC_FLEET_CHANNEL_URL: 'http://local.example/channel.json',
      });
      await expect(readlink(join(dir, '.aidlc-fleet.local.json'))).rejects.toThrow();
    } finally {
      await rm(outsideTarget, { recursive: true, force: true });
    }
  });

  test('save() leaves no leftover temp file behind on success', async () => {
    const dir = await makeTempDir();
    const store = new LocalConfigStore(dir);
    await store.save({ AIDLC_FLEET_CHANNEL_URL: 'http://local.example/channel.json' });
    const entries = await readdir(dir);
    expect(entries).toEqual(['.aidlc-fleet.local.json']);
  });
});
