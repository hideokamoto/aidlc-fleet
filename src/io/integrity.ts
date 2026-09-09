/**
 * Shared sha256-verify-before-handoff helper (`security-design.md`'s
 * synchronous ordering decision). Extracted during `ChannelClient`'s
 * Refactor step (plan Step 8) so `EngineInstaller`/`PluginManager` reuse
 * the exact same verification primitive rather than re-implementing hash
 * comparison at each call site.
 */
import { createHash } from 'node:crypto';

/**
 * Raised on a sha256 mismatch (BR7.1) — a hard failure, never silently
 * retried. `security-design.md`'s ordering decision: this check runs
 * synchronously immediately after download, before any handoff.
 *
 * Lives here (not in `channel-client.ts`) so both `ChannelClient` and any
 * other tarball-fetching caller (`EngineInstaller`/`PluginManager`) import
 * it from the same neutral module without a circular dependency.
 */
export class TarballIntegrityError extends Error {
  public readonly url: string;
  public readonly expectedSha256: string;
  public readonly actualSha256: string;

  constructor(url: string, expectedSha256: string, actualSha256: string) {
    super(
      `ChannelClient: sha256 mismatch for ${url} — expected ${expectedSha256}, got ${actualSha256}. ` +
        'This is a hard failure; the download is not retried automatically.',
    );
    this.name = 'TarballIntegrityError';
    this.url = url;
    this.expectedSha256 = expectedSha256;
    this.actualSha256 = actualSha256;
    Object.setPrototypeOf(this, TarballIntegrityError.prototype);
  }
}

/** Compute the lowercase hex sha256 digest of `bytes`. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Verify `bytes` against `expectedSha256`, throwing
 * {@link TarballIntegrityError} on mismatch (BR7.1: hard failure, no
 * retry). Returns the verified bytes unchanged on success, so callers can
 * inline this in a fetch pipeline: `verifySha256(url, expected, await
 * fetchBytes())`.
 */
export function verifySha256(url: string, expectedSha256: string, bytes: Uint8Array): Uint8Array {
  const actualSha256 = sha256Hex(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new TarballIntegrityError(url, expectedSha256, actualSha256);
  }
  return bytes;
}
