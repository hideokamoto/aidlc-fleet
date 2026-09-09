/**
 * `ChannelClient` — fetches the central channel declaration and
 * engine/plugin tarballs, verifying integrity before handing bytes to any
 * other component (`components.md`, `security-design.md`).
 *
 * Owns the only network I/O in this CLI. Never writes to the project's
 * own filesystem beyond a temp download area (that area is the caller's
 * concern — `EngineInstaller`/`PluginManager` decide where verified bytes
 * land).
 */
import { parseChannel, type Channel } from '../types/channel';
import { verifySha256, TarballIntegrityError } from './integrity';

/** Re-exported so existing importers of `TarballIntegrityError` from this module keep working. */
export { TarballIntegrityError };

/** Raised when fetching the channel declaration or a tarball fails at the transport level. */
export class ChannelFetchError extends Error {
  constructor(url: string, detail: string) {
    super(`ChannelClient: failed to fetch ${url}: ${detail}`);
    this.name = 'ChannelFetchError';
    Object.setPrototypeOf(this, ChannelFetchError.prototype);
  }
}

export class ChannelClient {
  private readonly fetchImpl: typeof fetch;

  /**
   * @param fetchImpl Injectable `fetch` implementation. Defaults to the
   *   global `fetch` (bun's built-in implementation, per
   *   `tech-stack-decisions.md` — no extra HTTP client dependency).
   *   Tests inject a stub so the suite never makes a real network call.
   */
  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  /**
   * Fetch and parse the channel declaration at `channelUrl` (a git repo's
   * raw file URL or a static URL, per `contract-summary.md` Contract 1).
   * Validates `Channel.schema` as part of parsing (BR7.2): an
   * unrecognized schema surfaces as `ChannelSchemaError`, not a guess.
   */
  async fetchChannel(channelUrl: string): Promise<Channel> {
    const response = await this.get(channelUrl);
    const text = await response.text();
    return parseChannel(text);
  }

  /**
   * Download a tarball and verify its sha256 against `expectedSha256`
   * (BR7.1) synchronously, before returning the bytes to the caller. A
   * mismatch throws {@link TarballIntegrityError} immediately — no
   * automatic retry.
   */
  async fetchTarball(url: string, expectedSha256: string): Promise<Uint8Array> {
    const response = await this.get(url);
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    return verifySha256(url, expectedSha256, bytes);
  }

  private async get(url: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url);
    } catch (cause) {
      throw new ChannelFetchError(url, String(cause));
    }
    if (!response.ok) {
      throw new ChannelFetchError(url, `HTTP ${response.status}`);
    }
    return response;
  }
}
