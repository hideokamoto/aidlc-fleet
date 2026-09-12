/**
 * `tar-extract.ts` の Business logic レイヤー（`parseTar`/`assertSafeEntry`/
 * `stripWrapperDirectory`）と Repository/data access レイヤー
 * （`extractTarGz`）のテスト（issue #5, FR1, FR4）。
 *
 * - `parseTar`/`assertSafeEntry`/`stripWrapperDirectory` はファイル I/O を
 *   持たない純粋関数なのでモック不要（unit-test-instructions.md のガイダ
 *   ンス通り、テストコード内で ustar ヘッダーを手組みしてバイト列を構築す
 *   る）。
 * - `extractTarGz` は team.md Mandated 規約により、実ファイルシステム
 *   （`mkdtemp`）に対する統合テストで検証する。モックでは代替しない。
 */
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { mkdtemp, rm, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseTar,
  assertSafeEntry,
  stripWrapperDirectory,
  extractTarGz,
  TarPathViolationError,
} from './tar-extract';
import type { TarEntry } from './tar-extract';

const BLOCK_SIZE = 512;

/**
 * ustar ヘッダー（512バイト）を1件手組みするテスト用ヘルパー。
 * `parseTar` の逆処理に相当する（unit-test-instructions.md「Test Data
 * Management」節の方針通り、バイナリフィクスチャファイルは追加しない）。
 */
function buildTarHeader(name: string, size: number, typeflag: string): Uint8Array {
  const header = new Uint8Array(BLOCK_SIZE);
  const encoder = new TextEncoder();
  const writeField = (value: string, offset: number, length: number) => {
    const bytes = encoder.encode(value);
    header.set(bytes.subarray(0, length), offset);
  };
  writeField(name, 0, 100);
  writeField('0000644', 100, 8); // mode
  writeField('0000000', 108, 8); // uid
  writeField('0000000', 116, 8); // gid
  writeField(size.toString(8).padStart(11, '0'), 124, 12); // size (octal)
  writeField('00000000000', 136, 12); // mtime
  writeField('        ', 148, 8); // chksum (unchecked by parseTar)
  header[156] = typeflag.charCodeAt(0);
  writeField('ustar', 257, 6); // magic
  writeField('00', 263, 2); // version
  return header;
}

/** 1つ以上のエントリから、末尾のゼロブロック2つを含む完全な tar バイト列を組み立てる。 */
function buildTarArchive(
  entries: Array<{ name: string; typeflag: string; content?: string }>,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    const content = entry.content ?? '';
    const contentBytes = encoderEncode(content);
    chunks.push(buildTarHeader(entry.name, contentBytes.length, entry.typeflag));
    if (contentBytes.length > 0) {
      const padded = new Uint8Array(Math.ceil(contentBytes.length / BLOCK_SIZE) * BLOCK_SIZE);
      padded.set(contentBytes);
      chunks.push(padded);
    }
  }
  chunks.push(new Uint8Array(BLOCK_SIZE * 2)); // end-of-archive marker
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function encoderEncode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('parseTar', () => {
  test('単一ファイルエントリを持つ最小 tar バイト列を正しくパースする', () => {
    const archive = buildTarArchive([{ name: 'hello.txt', typeflag: '0', content: 'hello world' }]);
    const entries = parseTar(archive);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('hello.txt');
    expect(entries[0]!.type).toBe('file');
    expect(new TextDecoder().decode(entries[0]!.data)).toBe('hello world');
  });

  test('ディレクトリエントリを正しくパースする', () => {
    const archive = buildTarArchive([{ name: 'some-dir/', typeflag: '5' }]);
    const entries = parseTar(archive);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('some-dir/');
    expect(entries[0]!.type).toBe('directory');
  });

  test('シンボリックリンクエントリ（typeflag "2"）を type: "symlink" として検出する', () => {
    const archive = buildTarArchive([{ name: 'link.txt', typeflag: '2' }]);
    const entries = parseTar(archive);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe('symlink');
  });

  test('複数エントリを順序通りにパースする', () => {
    const archive = buildTarArchive([
      { name: 'a.txt', typeflag: '0', content: 'a' },
      { name: 'b.txt', typeflag: '0', content: 'b' },
    ]);
    const entries = parseTar(archive);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt']);
  });
});

describe('assertSafeEntry — パス検証（FR4.1）', () => {
  function makeEntry(name: string, type: TarEntry['type']): TarEntry {
    return { name, type, data: new Uint8Array() };
  }

  test('"../" を含み展開先ルートの外側を指すエントリを TarPathViolationError で拒否する', () => {
    expect(() => assertSafeEntry(makeEntry('../escape.txt', 'file'))).toThrow(
      TarPathViolationError,
    );
  });

  test('絶対パスエントリを TarPathViolationError で拒否する', () => {
    expect(() => assertSafeEntry(makeEntry('/etc/passwd', 'file'))).toThrow(TarPathViolationError);
  });

  test('シンボリックリンク種別のエントリを TarPathViolationError で拒否する', () => {
    expect(() => assertSafeEntry(makeEntry('link.txt', 'symlink'))).toThrow(TarPathViolationError);
  });

  test('正常な相対パスのファイルエントリは受理する（例外を投げない）', () => {
    expect(() => assertSafeEntry(makeEntry('plugin.json', 'file'))).not.toThrow();
    expect(() => assertSafeEntry(makeEntry('sub/dir/file.txt', 'file'))).not.toThrow();
  });
});

describe('stripWrapperDirectory', () => {
  test('単一のトップレベルラッパーディレクトリを1階層除去する（GitHub codeload 規約）', () => {
    const entries: TarEntry[] = [
      { name: 'repo-abcdef/', type: 'directory', data: new Uint8Array() },
      { name: 'repo-abcdef/plugin.json', type: 'file', data: new Uint8Array() },
      { name: 'repo-abcdef/sub/file.txt', type: 'file', data: new Uint8Array() },
    ];
    const stripped = stripWrapperDirectory(entries);
    expect(stripped.map((e) => e.name)).toEqual(['plugin.json', 'sub/file.txt']);
  });

  test('複数のトップレベルディレクトリが混在する場合は何も除去しない', () => {
    const entries: TarEntry[] = [
      { name: 'dir-a/file.txt', type: 'file', data: new Uint8Array() },
      { name: 'dir-b/file.txt', type: 'file', data: new Uint8Array() },
    ];
    const stripped = stripWrapperDirectory(entries);
    expect(stripped.map((e) => e.name)).toEqual(['dir-a/file.txt', 'dir-b/file.txt']);
  });
});

/**
 * `extractTarGz` — 実ファイルシステム統合テスト（team.md Mandated: モック
 * では代替しない）。`file-ownership-guard.test.ts` の `mkdtemp` パターンに
 * 倣う。
 */
describe('extractTarGz（実ファイルシステム）', () => {
  let destDir: string;

  beforeEach(async () => {
    destDir = await mkdtemp(join(tmpdir(), 'aidlc-fleet-tar-extract-'));
  });

  afterEach(async () => {
    await rm(destDir, { recursive: true, force: true });
  });

  test('正常系: ラッパーディレクトリ付き gzip tar を展開し、期待するファイルツリーが実際に存在する（FR1.1〜FR1.4）', async () => {
    const archive = buildTarArchive([
      { name: 'example-plugin-abc123/', typeflag: '5' },
      {
        name: 'example-plugin-abc123/claude-code-plugin/plugin.json',
        typeflag: '0',
        content: '{"name":"example-plugin"}',
      },
      {
        name: 'example-plugin-abc123/claude-code-plugin/README.md',
        typeflag: '0',
        content: '# example',
      },
    ]);
    const gzipped = gzipSync(archive);

    await extractTarGz(gzipped, destDir);

    const pluginJson = await readFile(join(destDir, 'claude-code-plugin', 'plugin.json'), 'utf8');
    expect(pluginJson).toBe('{"name":"example-plugin"}');
    const readme = await readFile(join(destDir, 'claude-code-plugin', 'README.md'), 'utf8');
    expect(readme).toBe('# example');
  });

  test('パストラバーサル: "../" エントリを含む tar を展開しようとすると拒否され、展開先ディレクトリに部分ファイルが一切残っていない（FR4.1, FR4.2, R-01）', async () => {
    const archive = buildTarArchive([
      { name: 'wrapper/', typeflag: '5' },
      { name: 'wrapper/ok.txt', typeflag: '0', content: 'this must never land on disk' },
      { name: 'wrapper/../../escape.txt', typeflag: '0', content: 'evil' },
    ]);
    const gzipped = gzipSync(archive);

    await expect(extractTarGz(gzipped, destDir)).rejects.toThrow(TarPathViolationError);

    // 2パス設計（検証を全エントリ先に完了してから書き込み開始）により、
    // 拒否されたエントリより前に列挙された正常エントリ（ok.txt）すら
    // 書き込まれていないこと ＝ 部分ファイルが一切残っていないことを確認する。
    const remaining = await readdir(destDir);
    expect(remaining).toEqual([]);
  });

  test('シンボリックリンクエントリを含む tar を展開しようとすると拒否され、部分ファイルが残っていない（FR4.1, FR4.2）', async () => {
    const archive = buildTarArchive([
      { name: 'wrapper/', typeflag: '5' },
      { name: 'wrapper/ok.txt', typeflag: '0', content: 'this must never land on disk' },
      { name: 'wrapper/evil-link', typeflag: '2' },
    ]);
    const gzipped = gzipSync(archive);

    await expect(extractTarGz(gzipped, destDir)).rejects.toThrow(TarPathViolationError);

    const remaining = await readdir(destDir);
    expect(remaining).toEqual([]);
  });

  test('不正な gzip バイト列は例外として送出される（NFR2 フェイルファスト）', async () => {
    const notGzip = new TextEncoder().encode('this is not gzip data');
    await expect(extractTarGz(notGzip, destDir)).rejects.toThrow();
  });

  test('展開先ディレクトリが未作成でも自動的に作成される', async () => {
    const nestedDest = join(destDir, 'nested', 'target');
    const archive = buildTarArchive([{ name: 'wrapper/file.txt', typeflag: '0', content: 'x' }]);
    const gzipped = gzipSync(archive);

    await extractTarGz(gzipped, nestedDest);

    const content = await readFile(join(nestedDest, 'file.txt'), 'utf8');
    expect(content).toBe('x');
    const stats = await stat(nestedDest);
    expect(stats.isDirectory()).toBe(true);
  });
});
