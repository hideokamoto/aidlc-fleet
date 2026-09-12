import { test, expect, describe, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
});
