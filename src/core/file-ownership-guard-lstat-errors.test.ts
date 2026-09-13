/**
 * issue #30, problem 3: `FileOwnershipGuard.assertNoSymlinkInPath`'s catch
 * clause swallowed EVERY `lstat` error as "this path segment doesn't exist
 * yet" (the expected `ENOENT` case), instead of checking
 * `(err as NodeJS.ErrnoException).code`. Any other failure — permission
 * denied, "not a directory", etc. — was silently treated as "not yet
 * created" and the write proceeded, breaking the fail-fast guarantee
 * `project.md`'s Mandated rules require for file-ownership-invariant
 * violations.
 *
 * This is a REAL filesystem integration test (team.md Mandated: M4 must be
 * verified against real fs, not mocks). It deliberately does NOT use
 * `EACCES` (a plain `chmod` doesn't work: this sandbox — and most CI
 * containers — run as root, which bypasses ordinary Unix permission bits
 * entirely, confirmed by hand: `chmod 000` on a directory still lets root
 * `lstat` its children). Instead it produces a genuine, non-`ENOENT`
 * `lstat` failure that no user id can bypass: `ENOTDIR`, raised when a
 * path treats an existing plain FILE as if it were a directory to
 * descend into. This is a real bug shape too — a caller racing this guard
 * could replace a directory segment with a file between checks.
 */
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileOwnershipGuard } from './file-ownership-guard';

describe('FileOwnershipGuard.assertNoSymlinkInPath — non-ENOENT lstat errors (real filesystem)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'aidlc-fleet-guard-enotdir-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('a non-ENOENT lstat error (ENOTDIR) partway up the ancestor chain is rethrown, not swallowed as "not yet created"', async () => {
    // `actually-a-file` is a plain file, not a directory. Any path that
    // treats it as an intermediate directory segment fails `lstat` with
    // ENOTDIR (a real, unavoidable error — reproduced by hand against
    // Node's `fs.lstatSync` before writing this test), never ENOENT.
    const notADirectory = join(root, 'actually-a-file');
    await writeFile(notADirectory, 'not a directory', 'utf8');
    const targetPath = join(notADirectory, 'subdir', 'file.txt');

    const guard = new FileOwnershipGuard({ projectRoot: root });

    // Before the fix: the ENOTDIR error from lstat(join(notADirectory,
    // 'subdir')) was swallowed as "doesn't exist yet", so this call
    // resolved silently instead of surfacing the real filesystem error.
    await expect(
      guard.checkWriteAllowed(targetPath, { isInitialSeedCopy: false }),
    ).rejects.toThrow(/ENOTDIR/);
  });
});
