import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, symlink, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileOwnershipGuard, FileOwnershipViolation } from './file-ownership-guard';

// These are REAL filesystem integration tests against a temp directory,
// per team.md's Mandated rule: mocks cannot verify these invariants
// (BR2.1-BR2.6). Nothing here mocks fs.

describe('FileOwnershipGuard (real filesystem)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'aidlc-fleet-guard-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('BR2.1: replacing an engine-owned directory without --force fails fast, no write occurs', async () => {
    const engineDir = join(root, '.claude');
    await mkdir(engineDir, { recursive: true });
    await writeFile(join(engineDir, 'marker.txt'), 'original', 'utf8');

    const guard = new FileOwnershipGuard({ projectRoot: root });
    await expect(guard.checkEngineDirectoryReplace(engineDir, { force: false })).rejects.toThrow(
      FileOwnershipViolation,
    );

    // No write occurred — original file untouched.
    const content = await readFile(join(engineDir, 'marker.txt'), 'utf8');
    expect(content).toBe('original');
  });

  test('BR2.1: replacing an engine-owned directory with --force creates a backup first', async () => {
    const engineDir = join(root, '.claude');
    await mkdir(engineDir, { recursive: true });
    await writeFile(join(engineDir, 'marker.txt'), 'original', 'utf8');

    const guard = new FileOwnershipGuard({ projectRoot: root });
    const result = await guard.checkEngineDirectoryReplace(engineDir, { force: true });

    expect(result.backupPath).toBeTruthy();
    const backupContent = await readFile(join(result.backupPath, 'marker.txt'), 'utf8');
    expect(backupContent).toBe('original');
  });

  test('BR2.3: a write under aidlc/ (other than the seed copy) is refused', async () => {
    const aidlcPath = join(root, 'aidlc', 'spaces', 'default', 'intents.json');
    await mkdir(join(root, 'aidlc', 'spaces', 'default'), { recursive: true });

    const guard = new FileOwnershipGuard({ projectRoot: root });
    await expect(guard.checkWriteAllowed(aidlcPath, { isInitialSeedCopy: false })).rejects.toThrow(
      FileOwnershipViolation,
    );
  });

  test('BR2.3: the one-time initial memory-seed copy under aidlc/ is allowed', async () => {
    const aidlcPath = join(root, 'aidlc', 'spaces', 'default', 'memory', 'org.md');
    const guard = new FileOwnershipGuard({ projectRoot: root });
    await expect(
      guard.checkWriteAllowed(aidlcPath, { isInitialSeedCopy: true }),
    ).resolves.toBeUndefined();
  });

  test('BR2.4: a write whose resolved path traverses a symlink is refused', async () => {
    const realDir = join(root, 'real-target');
    await mkdir(realDir, { recursive: true });
    const linkPath = join(root, 'link-to-real');
    await symlink(realDir, linkPath, 'dir');
    const writeThroughLink = join(linkPath, 'file.txt');

    const guard = new FileOwnershipGuard({ projectRoot: root });
    await expect(
      guard.checkWriteAllowed(writeThroughLink, { isInitialSeedCopy: false }),
    ).rejects.toThrow(FileOwnershipViolation);

    // Confirm no file was actually created through the symlink.
    const entries = await readdir(realDir);
    expect(entries).toEqual([]);
  });

  test('BR2.4: a write to an ordinary (non-symlinked) path is allowed', async () => {
    const plainPath = join(root, 'ordinary-file.txt');
    const guard = new FileOwnershipGuard({ projectRoot: root });
    await expect(
      guard.checkWriteAllowed(plainPath, { isInitialSeedCopy: false }),
    ).resolves.toBeUndefined();
  });

  test('BR2.5: a file outside the current receipt is never auto-deleted', async () => {
    const managedDir = join(root, '.claude');
    await mkdir(managedDir, { recursive: true });
    await writeFile(join(managedDir, 'receipted.txt'), 'keep', 'utf8');
    await writeFile(join(managedDir, 'user-added.txt'), 'user content', 'utf8');

    const guard = new FileOwnershipGuard({ projectRoot: root });
    const receipt = new Set([join(managedDir, 'receipted.txt')]);
    const deletable = await guard.filterDeletable(
      [join(managedDir, 'receipted.txt'), join(managedDir, 'user-added.txt')],
      receipt,
    );

    expect(deletable).toEqual([join(managedDir, 'receipted.txt')]);
    // The non-receipted file must still exist on disk — this guard never deletes it itself.
    const stillThere = await readFile(join(managedDir, 'user-added.txt'), 'utf8');
    expect(stillThere).toBe('user content');
  });

  test('BR2.6: a detected violation raises immediately rather than a warning-and-continue result', async () => {
    const engineDir = join(root, '.claude');
    await mkdir(engineDir, { recursive: true });
    const guard = new FileOwnershipGuard({ projectRoot: root });

    let threw = false;
    try {
      await guard.checkEngineDirectoryReplace(engineDir, { force: false });
    } catch (err) {
      threw = err instanceof FileOwnershipViolation;
    }
    expect(threw).toBe(true);
  });

  test('BR2.2: settings.json merge — engine wins on hooks/statusLine, project wins elsewhere', () => {
    const guard = new FileOwnershipGuard({ projectRoot: root });
    const merged = guard.mergeSettings(
      { hooks: { onStart: 'project-hook' }, statusLine: 'project-status', theme: 'project-theme' },
      { hooks: { onStart: 'engine-hook' }, statusLine: 'engine-status', otherKey: 'engine-value' },
    );
    expect(merged.hooks).toEqual({ onStart: 'engine-hook' });
    expect(merged.statusLine).toBe('engine-status');
    expect(merged.theme).toBe('project-theme');
    expect(merged.otherKey).toBe('engine-value');
  });
});
