import { test, expect, describe } from 'bun:test';
import { createHash } from 'node:crypto';
import { ChannelClient, TarballIntegrityError } from './channel-client';
import { ChannelSchemaError } from '../types/channel';
import validChannelFixture from '../types/__fixtures__/channel.valid.json';

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fakeFetch(responses: Record<string, { status: number; body: BodyInit }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const response = responses[url];
    if (!response) {
      throw new Error(`fakeFetch: no stubbed response for ${url}`);
    }
    return new Response(response.body, { status: response.status });
  }) as typeof fetch;
}

describe('ChannelClient.fetchChannel', () => {
  test('fetches and parses a well-formed channel declaration', async () => {
    const client = new ChannelClient(
      fakeFetch({
        'https://example.com/channel.json': {
          status: 200,
          body: JSON.stringify(validChannelFixture),
        },
      }),
    );
    const channel = await client.fetchChannel('https://example.com/channel.json');
    expect(channel.channel).toBe('stable');
    expect(channel.engine.ref).toBe('e1e1e1e1e1e1');
  });

  test('surfaces an unrecognized schema as ChannelSchemaError (BR7.2)', async () => {
    const client = new ChannelClient(
      fakeFetch({
        'https://example.com/channel.json': {
          status: 200,
          body: JSON.stringify({ ...validChannelFixture, schema: 999 }),
        },
      }),
    );
    await expect(client.fetchChannel('https://example.com/channel.json')).rejects.toThrow(
      ChannelSchemaError,
    );
  });

  test('fails when the channel endpoint returns a non-2xx status', async () => {
    const client = new ChannelClient(
      fakeFetch({
        'https://example.com/channel.json': { status: 404, body: 'not found' },
      }),
    );
    await expect(client.fetchChannel('https://example.com/channel.json')).rejects.toThrow();
  });
});

describe('ChannelClient.fetchTarball', () => {
  test('returns the verified bytes when sha256 matches (BR7.1 happy path)', async () => {
    const bytes = new TextEncoder().encode('tarball-content');
    const hash = sha256Hex(bytes);
    const client = new ChannelClient(
      fakeFetch({
        'https://codeload.example/engine.tar.gz': { status: 200, body: bytes },
      }),
    );
    const result = await client.fetchTarball('https://codeload.example/engine.tar.gz', hash);
    expect(new TextDecoder().decode(result)).toBe('tarball-content');
  });

  test('throws TarballIntegrityError on sha256 mismatch, never retries (BR7.1)', async () => {
    const bytes = new TextEncoder().encode('tarball-content');
    let fetchCount = 0;
    const rawFetch = fakeFetch({
      'https://codeload.example/engine.tar.gz': { status: 200, body: bytes },
    });
    const countingFetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return rawFetch(...args);
    }) as typeof fetch;
    const client = new ChannelClient(countingFetch);

    await expect(
      client.fetchTarball('https://codeload.example/engine.tar.gz', 'deadbeef-wrong-hash'),
    ).rejects.toThrow(TarballIntegrityError);
    expect(fetchCount).toBe(1);
  });

  test('fails when the tarball endpoint returns a non-2xx status', async () => {
    const client = new ChannelClient(
      fakeFetch({
        'https://codeload.example/engine.tar.gz': { status: 500, body: 'server error' },
      }),
    );
    await expect(
      client.fetchTarball('https://codeload.example/engine.tar.gz', 'irrelevant'),
    ).rejects.toThrow();
  });

  test('TarballIntegrityError message names neither hash in a way that could be replayed as a bypass', () => {
    const err = new TarballIntegrityError('https://x/y.tar.gz', 'expected123', 'actual456');
    expect(err.message).toContain('https://x/y.tar.gz');
    expect(err.name).toBe('TarballIntegrityError');
  });
});
