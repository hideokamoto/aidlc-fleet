/**
 * `tar-extractor` — turns a downloaded `.tar.gz` archive (GitHub codeload
 * tarball, per `real-deps.ts`'s `buildTarballUrl`) into real files on
 * disk.
 *
 * This closes a previously-undone step: `EngineInstaller`/`PluginManager`
 * used to hand the verified tarball bytes straight to `placeEngine`/
 * `placeProjection`, which wrote them out as a single opaque `.tar` file
 * rather than extracting it — so nothing downstream (the operator-
 * configured compose command, `dist/<harness>/...` lookups, etc.) ever
 * saw real files. Unpacking a downloaded archive onto disk is plain I/O,
 * not upstream's `install.ts`/`compose.ts` placement logic (which still
 * decides *where* extracted files end up in the project) — so extracting
 * here does not cross project.md's Forbidden "never reimplement
 * upstream's plugin-compose logic" rule.
 *
 * `parseTar`/`gunzipAndParseTar` are pure (no filesystem access) so the
 * archive format itself is unit-testable without touching disk;
 * `extractTarGzToDir` is the one function here that actually writes
 * files, kept deliberately thin over `parseTar`'s output.
 */
import { gunzipSync } from 'node:zlib';
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type TarEntryType = 'file' | 'directory' | 'symlink' | 'other';

export interface TarEntry {
  /** Path exactly as recorded in the archive (ustar `prefix`/`name`, or a GNU-longname/pax override). */
  path: string;
  type: TarEntryType;
  content: Uint8Array;
  linkname?: string;
  /** POSIX permission bits from the ustar `mode` field (e.g. `0o755`). */
  mode: number;
}

/** Raised when the archive bytes cannot be parsed as a well-formed tar stream. */
export class TarFormatError extends Error {
  constructor(message: string) {
    super(`tar-extractor: ${message}`);
    this.name = 'TarFormatError';
    Object.setPrototypeOf(this, TarFormatError.prototype);
  }
}

const BLOCK_SIZE = 512;

function readCString(block: Uint8Array, start: number, length: number): string {
  const slice = block.subarray(start, start + length);
  const nul = slice.indexOf(0);
  const bytes = nul === -1 ? slice : slice.subarray(0, nul);
  return Buffer.from(bytes).toString('utf8').trim();
}

function readOctal(block: Uint8Array, start: number, length: number): number {
  const raw = readCString(block, start, length);
  if (raw.length === 0) return 0;
  const value = parseInt(raw, 8);
  if (Number.isNaN(value)) {
    throw new TarFormatError(`non-octal numeric field at offset ${start}: ${JSON.stringify(raw)}`);
  }
  return value;
}

function isAllZero(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i += 1) {
    if (block[i] !== 0) return false;
  }
  return true;
}

function typeflagToType(typeflag: string): TarEntryType {
  if (typeflag === '' || typeflag === '0') return 'file';
  if (typeflag === '5') return 'directory';
  if (typeflag === '2') return 'symlink';
  return 'other';
}

/**
 * Parses PAX extended-header records (`git archive`'s format for paths or
 * metadata that don't fit ustar's fixed-width fields) — each record is
 * `"<decimal length> <key>=<value>\n"`, length-prefixed so keys/values may
 * contain any byte including newlines.
 */
function parsePaxRecords(body: Uint8Array): Record<string, string> {
  const text = Buffer.from(body).toString('utf8');
  const records: Record<string, string> = {};
  let offset = 0;
  while (offset < text.length) {
    const spaceIndex = text.indexOf(' ', offset);
    if (spaceIndex === -1) break;
    const recordLength = parseInt(text.slice(offset, spaceIndex), 10);
    if (!Number.isFinite(recordLength) || recordLength <= 0) break;
    const record = text.slice(offset, offset + recordLength);
    const eq = record.indexOf('=', spaceIndex - offset);
    if (eq !== -1) {
      const key = record.slice(spaceIndex - offset + 1, eq);
      const value = record.slice(eq + 1).replace(/\n$/, '');
      records[key] = value;
    }
    offset += recordLength;
  }
  return records;
}

/**
 * Parses a raw (already-gunzipped) ustar/GNU/PAX tar byte stream into a
 * flat list of entries. Supports the extensions GitHub codeload archives
 * actually use: ustar `prefix` for paths over 100 bytes, GNU long-name
 * (`typeflag 'L'`) entries, and PAX extended headers (`typeflag 'x'`).
 */
export function parseTar(buffer: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let pendingLongName: string | undefined;
  let pendingPax: Record<string, string> | undefined;

  while (offset + BLOCK_SIZE <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK_SIZE);
    if (isAllZero(header)) break; // two-zero-block end-of-archive marker; one is enough to stop here

    const name = readCString(header, 0, 100);
    const mode = readOctal(header, 100, 8);
    const size = readOctal(header, 124, 12);
    const typeflag = readCString(header, 156, 1);
    const linkname = readCString(header, 157, 100);
    const magic = readCString(header, 257, 6);
    const prefix = magic.startsWith('ustar') ? readCString(header, 345, 155) : '';

    const contentStart = offset + BLOCK_SIZE;
    const contentEnd = contentStart + size;
    if (contentEnd > buffer.length) {
      throw new TarFormatError(
        `entry ${JSON.stringify(name)} declares size ${size} past the end of the archive`,
      );
    }
    const body = buffer.subarray(contentStart, contentEnd);
    const paddedSize = Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
    offset = contentStart + paddedSize;

    if (typeflag === 'L') {
      // GNU long-name: body is the real name of the *next* header.
      pendingLongName = Buffer.from(body).toString('utf8').replace(/\0+$/, '');
      continue;
    }
    if (typeflag === 'x' || typeflag === 'g') {
      // PAX extended header (per-entry 'x' or archive-wide 'g'): applies to the next header.
      pendingPax = { ...pendingPax, ...parsePaxRecords(body) };
      continue;
    }

    const resolvedName =
      pendingLongName ?? pendingPax?.path ?? (prefix ? `${prefix}/${name}` : name);
    entries.push({
      path: resolvedName,
      type: typeflagToType(typeflag),
      content: body,
      linkname: linkname.length > 0 ? linkname : undefined,
      mode,
    });
    pendingLongName = undefined;
    pendingPax = undefined;
  }

  return entries;
}

/** Gunzips `bytes` (a `.tar.gz` archive) and parses the result as a tar stream. */
export function gunzipAndParseTar(bytes: Uint8Array): TarEntry[] {
  const tarBytes = gunzipSync(bytes);
  return parseTar(tarBytes);
}

export interface ExtractTarGzOptions {
  /**
   * Leading path segments to drop from every entry before writing —
   * GitHub codeload archives always wrap their content in one
   * `<repo>-<ref>/` directory, so callers extracting a codeload tarball
   * pass `1`. Defaults to `0` (no stripping).
   */
  stripComponents?: number;
}

/**
 * Extracts a `.tar.gz` archive's regular files and directories onto disk
 * under `destDir`. Symlink entries are skipped rather than materialized
 * (project.md's Forbidden "never write through a symlink" rule makes
 * writing untrusted-archive-controlled symlinks onto disk the wrong
 * default; nothing in this CLI's own contract requires them). Entries
 * that would resolve outside `destDir` (`..` path segments, a classic
 * "zip slip") are rejected instead of silently skipped, since that shape
 * only ever indicates a malformed or hostile archive.
 */
export async function extractTarGzToDir(
  bytes: Uint8Array,
  destDir: string,
  options: ExtractTarGzOptions = {},
): Promise<string[]> {
  const strip = options.stripComponents ?? 0;
  const entries = gunzipAndParseTar(bytes);
  const written: string[] = [];

  for (const entry of entries) {
    const segments = entry.path.split('/').filter((segment) => segment.length > 0);
    const stripped = segments.slice(strip);
    if (stripped.length === 0) continue; // the wrapper directory itself

    if (stripped.includes('..')) {
      throw new TarFormatError(`refusing entry with a path-traversal segment: ${entry.path}`);
    }
    const relativePath = stripped.join('/');
    const targetPath = join(destDir, relativePath);

    if (entry.type === 'directory') {
      await mkdir(targetPath, { recursive: true });
      continue;
    }
    if (entry.type === 'symlink' || entry.type === 'other') {
      continue;
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, entry.content);
    // writeFile's default mode already applied the process umask; layer the
    // archive's executable bits on top of whatever that produced, rather
    // than reproducing the archive's full mode (which would also fight the
    // umask for read/write bits).
    if ((entry.mode & 0o111) !== 0) {
      const writtenStat = await stat(targetPath);
      await chmod(targetPath, writtenStat.mode | (entry.mode & 0o111));
    }
    written.push(relativePath);
  }

  return written;
}
