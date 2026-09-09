/**
 * Tests for `tar-extractor.ts`: the archive-format parser (`parseTar`,
 * pure — no filesystem) and the real-filesystem extraction path
 * (`extractTarGzToDir`), per team.md's Mandated real-fs-integration-test
 * convention for anything that actually writes to disk.
 *
 * Fixture tarballs are hand-built here (raw 512-byte ustar blocks) rather
 * than shelled out to a `tar` binary, so the suite has no external tool
 * dependency and stays fast/hermetic.
 */
import { test, expect, describe } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTar, gunzipAndParseTar, extractTarGzToDir, TarFormatError } from './tar-extractor';

const BLOCK_SIZE = 512;

function block(): Uint8Array {
  return new Uint8Array(BLOCK_SIZE);
}

function writeField(target: Uint8Array, start: number, value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  target.set(bytes.subarray(0, Math.min(bytes.length, target.length - start)), start);
}

function writeOctalField(target: Uint8Array, start: number, length: number, value: number): void {
  const octal = value.toString(8).padStart(length - 1, '0');
  writeField(target, start, octal);
}

/** Builds one ustar header block for a regular file or directory entry. */
function buildHeader(opts: { name: string; size: number; typeflag: string }): Uint8Array {
  const header = block();
  writeField(header, 0, opts.name);
  writeOctalField(header, 100, 8, 0o644);
  writeOctalField(header, 108, 8, 0);
  writeOctalField(header, 116, 8, 0);
  writeOctalField(header, 124, 12, opts.size);
  writeOctalField(header, 136, 12, 0);
  writeField(header, 148, '        '); // chksum placeholder, unread by parseTar
  writeField(header, 156, opts.typeflag);
  writeField(header, 257, 'ustar\0');
  writeField(header, 263, '00');
  return header;
}

function padToBlock(content: Uint8Array): Uint8Array {
  const paddedLength = Math.ceil(content.length / BLOCK_SIZE) * BLOCK_SIZE;
  const padded = new Uint8Array(paddedLength);
  padded.set(content, 0);
  return padded;
}

function buildFileEntry(name: string, content: string): Uint8Array {
  const contentBytes = Buffer.from(content, 'utf8');
  const header = buildHeader({ name, size: contentBytes.length, typeflag: '0' });
  return concat([header, padToBlock(contentBytes)]);
}

function buildDirEntry(name: string): Uint8Array {
  return buildHeader({ name, size: 0, typeflag: '5' });
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function endOfArchiveMarker(): Uint8Array {
  return concat([block(), block()]);
}

/** Builds one self-length-prefixed PAX extended-header record: `"<len> key=value\n"`. */
function buildPaxRecord(key: string, value: string): string {
  const suffix = ` ${key}=${value}\n`;
  let len = suffix.length + 1;
  for (;;) {
    const total = String(len).length + suffix.length;
    if (total === len) return `${len}${suffix}`;
    len = total;
  }
}

describe('parseTar', () => {
  test('parses a single-file archive', () => {
    const tar = concat([buildFileEntry('hello.txt', 'hi there'), endOfArchiveMarker()]);
    const entries = parseTar(tar);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe('hello.txt');
    expect(entries[0]!.type).toBe('file');
    expect(Buffer.from(entries[0]!.content).toString('utf8')).toBe('hi there');
  });

  test('parses nested directories and files in archive order', () => {
    const tar = concat([
      buildDirEntry('pkg/'),
      buildFileEntry('pkg/a.txt', 'a'),
      buildFileEntry('pkg/nested/b.txt', 'bb'),
      endOfArchiveMarker(),
    ]);
    const entries = parseTar(tar);
    expect(entries.map((e) => [e.path, e.type])).toEqual([
      ['pkg/', 'directory'],
      ['pkg/a.txt', 'file'],
      ['pkg/nested/b.txt', 'file'],
    ]);
  });

  test('resolves a ustar prefix field onto the name', () => {
    const header = buildHeader({ name: 'deep/file.txt', size: 1, typeflag: '0' });
    writeField(header, 345, 'a/very/long/prefix');
    const tar = concat([header, padToBlock(Buffer.from('x')), endOfArchiveMarker()]);
    const entries = parseTar(tar);
    expect(entries[0]!.path).toBe('a/very/long/prefix/deep/file.txt');
  });

  test('resolves a GNU long-name (typeflag L) entry onto the following header', () => {
    const longName = 'this/path/is/spelled/out/via/a/long-name/extension/entry.txt';
    const longNameHeader = buildHeader({ name: '', size: longName.length, typeflag: 'L' });
    const longNameBody = padToBlock(Buffer.from(`${longName}\0`, 'utf8'));
    const fileEntry = buildFileEntry('ignored-short-name.txt', 'content');
    const tar = concat([longNameHeader, longNameBody, fileEntry, endOfArchiveMarker()]);
    const entries = parseTar(tar);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe(longName);
  });

  test('resolves a PAX extended header (typeflag x) path override', () => {
    const paxPath = 'pax/overridden/path.txt';
    const fullRecord = buildPaxRecord('path', paxPath);
    const paxHeader = buildHeader({ name: '', size: fullRecord.length, typeflag: 'x' });
    const paxBody = padToBlock(Buffer.from(fullRecord, 'utf8'));
    const fileEntry = buildFileEntry('short-name.txt', 'body');
    const tar = concat([paxHeader, paxBody, fileEntry, endOfArchiveMarker()]);
    const entries = parseTar(tar);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe(paxPath);
  });

  test('throws TarFormatError when a declared size runs past the archive', () => {
    const header = buildHeader({ name: 'broken.txt', size: 999_999, typeflag: '0' });
    expect(() => parseTar(header)).toThrow(TarFormatError);
  });
});

describe('gunzipAndParseTar', () => {
  test('gunzips then parses a gzip-compressed tarball', () => {
    const tar = concat([buildFileEntry('hello.txt', 'hi there'), endOfArchiveMarker()]);
    const gz = gzipSync(Buffer.from(tar));
    const entries = gunzipAndParseTar(gz);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe('hello.txt');
  });
});

describe('extractTarGzToDir', () => {
  test('writes files and directories from a real gzip archive to disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidlc-fleet-tar-'));
    try {
      const tar = concat([
        buildDirEntry('repo-abc123/'),
        buildFileEntry('repo-abc123/README.md', '# hi'),
        buildFileEntry('repo-abc123/dist/claude/.claude/settings.json', '{}'),
        endOfArchiveMarker(),
      ]);
      const gz = gzipSync(Buffer.from(tar));

      const written = await extractTarGzToDir(gz, dir, { stripComponents: 1 });

      expect(written.sort()).toEqual(['README.md', 'dist/claude/.claude/settings.json'].sort());
      expect(await readFile(join(dir, 'README.md'), 'utf8')).toBe('# hi');
      expect(await readFile(join(dir, 'dist/claude/.claude/settings.json'), 'utf8')).toBe('{}');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects a path-traversal entry instead of writing outside destDir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidlc-fleet-tar-'));
    try {
      const tar = concat([buildFileEntry('../escape.txt', 'nope'), endOfArchiveMarker()]);
      const gz = gzipSync(Buffer.from(tar));
      await expect(extractTarGzToDir(gz, dir, { stripComponents: 0 })).rejects.toThrow(
        TarFormatError,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('skips symlink entries rather than materializing them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidlc-fleet-tar-'));
    try {
      const linkHeader = buildHeader({ name: 'link.txt', size: 0, typeflag: '2' });
      writeField(linkHeader, 157, '/etc/passwd');
      const tar = concat([linkHeader, endOfArchiveMarker()]);
      const gz = gzipSync(Buffer.from(tar));

      const written = await extractTarGzToDir(gz, dir, {});
      expect(written).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
