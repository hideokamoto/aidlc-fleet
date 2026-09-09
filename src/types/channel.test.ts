import { test, expect } from 'bun:test';
import { parseChannel, ChannelParseError, ChannelSchemaError } from './channel';
import validFixture from './__fixtures__/channel.valid.json';

test('parseChannel accepts a well-formed channel and returns typed fields', () => {
  const channel = parseChannel(JSON.stringify(validFixture));
  expect(channel.schema).toBe(1);
  expect(channel.channel).toBe('stable');
  expect(channel.engine.ref).toBe('e1e1e1e1e1e1');
  expect(channel.migration_boundaries).toHaveLength(1);
  expect(channel.migration_boundaries[0]?.action).toBe('manual');
});

test('parseChannel throws ChannelSchemaError on an unrecognized schema value (BR7.2: surfaced, not guessed)', () => {
  const futureSchema = { ...validFixture, schema: 999 };
  expect(() => parseChannel(JSON.stringify(futureSchema))).toThrow(ChannelSchemaError);
});

test('ChannelSchemaError is a distinct subtype callers can branch on', () => {
  const futureSchema = { ...validFixture, schema: 999 };
  try {
    parseChannel(JSON.stringify(futureSchema));
    throw new Error('expected parseChannel to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(ChannelSchemaError);
    expect(err).toBeInstanceOf(ChannelParseError);
    expect((err as ChannelSchemaError).name).toBe('ChannelSchemaError');
  }
});

test('parseChannel throws ChannelParseError on malformed JSON', () => {
  expect(() => parseChannel('{not valid')).toThrow(ChannelParseError);
});

test('parseChannel throws ChannelParseError when a required field is missing', () => {
  const broken = { ...validFixture } as Record<string, unknown>;
  delete broken.engine;
  expect(() => parseChannel(JSON.stringify(broken))).toThrow(ChannelParseError);
});

test('parseChannel accepts optional settings_overlay/mcp_overlay as opaque pass-through', () => {
  const withOverlays = {
    ...validFixture,
    settings_overlay: { foo: 'bar' },
    mcp_overlay: { baz: [1, 2, 3] },
  };
  const channel = parseChannel(JSON.stringify(withOverlays));
  expect(channel.settings_overlay).toEqual({ foo: 'bar' });
  expect(channel.mcp_overlay).toEqual({ baz: [1, 2, 3] });
});

test('parseChannel defaults missing migration_boundaries/plugins to empty arrays', () => {
  const minimal = { ...validFixture } as Record<string, unknown>;
  delete minimal.migration_boundaries;
  delete minimal.plugins;
  const channel = parseChannel(JSON.stringify(minimal));
  expect(channel.migration_boundaries).toEqual([]);
  expect(channel.plugins).toEqual([]);
});

test('parseChannel ignores unrecognized additive fields', () => {
  const withExtra = { ...validFixture, some_future_field: true };
  const channel = parseChannel(JSON.stringify(withExtra));
  expect(channel.channel).toBe('stable');
});
