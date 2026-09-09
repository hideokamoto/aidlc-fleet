import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LockfileStore, LockfileAbsentError, LockfileMalformedError } from './lockfile-store';
import validFixture from '../types/__fixtures__/lockfile.valid.json';
import type { Lockfile } from '../types/lockfile';

describe('LockfileStore', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'aidlc-fleet-lockfile-'));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  test('load() throws LockfileAbsentError when aidlc.lock.json does not exist (BR8.1)', async () => {
    const store = new LockfileStore(projectDir);
    await expect(store.load()).rejects.toThrow(LockfileAbsentError);
  });

  test('load() throws LockfileMalformedError distinctly from LockfileAbsentError (BR8.1)', async () => {
    await writeFile(join(projectDir, 'aidlc.lock.json'), '{not valid json', 'utf8');
    const store = new LockfileStore(projectDir);
    await expect(store.load()).rejects.toThrow(LockfileMalformedError);
    let threwAbsent = false;
    try {
      await store.load();
    } catch (err) {
      threwAbsent = err instanceof LockfileAbsentError;
    }
    expect(threwAbsent).toBe(false);
  });

  test('save() then load() round-trips the Lockfile', async () => {
    const store = new LockfileStore(projectDir);
    await store.save(validFixture as unknown as Lockfile);
    const loaded = await store.load();
    expect(loaded.channel).toBe('stable');
    expect(loaded.plugins).toHaveLength(1);
  });

  test('save() writes atomically via write-temp + rename — no .tmp file survives a successful save (NFR4.1)', async () => {
    const store = new LockfileStore(projectDir);
    await store.save(validFixture as unknown as Lockfile);
    await expect(readFile(join(projectDir, 'aidlc.lock.json.tmp'), 'utf8')).rejects.toThrow();
    const raw = await readFile(join(projectDir, 'aidlc.lock.json'), 'utf8');
    expect(JSON.parse(raw).channel).toBe('stable');
  });

  test('pin(ref) sets Lockfile.pin (BR6.1)', async () => {
    const store = new LockfileStore(projectDir);
    await store.save(validFixture as unknown as Lockfile);
    await store.pin('deadbeefcafe');
    const loaded = await store.load();
    expect(loaded.pin).toBe('deadbeefcafe');
  });

  test('unpin() clears Lockfile.pin (BR6.1)', async () => {
    const store = new LockfileStore(projectDir);
    await store.save({ ...(validFixture as unknown as Lockfile), pin: 'deadbeefcafe' });
    await store.unpin();
    const loaded = await store.load();
    expect(loaded.pin).toBeNull();
  });

  test('save() creates the project directory tree if missing', async () => {
    const nested = join(projectDir, 'nested', 'project');
    const store = new LockfileStore(nested);
    await mkdir(nested, { recursive: true });
    await store.save(validFixture as unknown as Lockfile);
    const loaded = await store.load();
    expect(loaded.channel).toBe('stable');
  });

  test('exists() reflects whether aidlc.lock.json is present', async () => {
    const store = new LockfileStore(projectDir);
    expect(await store.exists()).toBe(false);
    await store.save(validFixture as unknown as Lockfile);
    expect(await store.exists()).toBe(true);
  });
});
