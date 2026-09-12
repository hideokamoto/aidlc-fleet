import { test, expect, describe } from 'bun:test';
import { runPluginAdd, runPluginRemove } from './plugin';
import { makeFakeDeps, makeChannel, makeLockfile } from './__fixtures__/test-deps';

describe('runPluginAdd (CommandLayer)', () => {
  test('exits 0 on success', async () => {
    const { deps } = makeFakeDeps({
      channel: makeChannel({
        plugins: [{ name: 'p1', repo: 'org/p1', ref: 'r', version: '1.0.0', sha256: 'x' }],
      }),
    });
    const result = await runPluginAdd('p1', deps);
    expect(result.exitCode).toBe(0);
  });

  test('issue #14: notes when doctorConfigured is false on an otherwise successful add', async () => {
    const { deps, logs } = makeFakeDeps({
      channel: makeChannel({
        plugins: [{ name: 'p1', repo: 'org/p1', ref: 'r', version: '1.0.0', sha256: 'x' }],
      }),
    });
    deps.pluginManager.add = async () => ({
      success: true,
      compose: { exitCode: 0, dropsFileContent: '' },
      pluginSyncClassification: 'ok',
      doctorConfigured: false,
    });
    const result = await runPluginAdd('p1', deps);
    expect(result.exitCode).toBe(0);
    expect(logs.stdout.join('\n').toLowerCase()).toContain('not configured');
  });

  test('exits 4 when SuccessVerifier fails, no gate/drift involvement', async () => {
    const { deps } = makeFakeDeps({
      channel: makeChannel({
        plugins: [{ name: 'p1', repo: 'org/p1', ref: 'r', version: '1.0.0', sha256: 'x' }],
      }),
    });
    deps.pluginManager.add = async () => ({
      success: false,
      compose: { exitCode: 1, dropsFileContent: '' },
      pluginSyncClassification: 'failure',
      doctorConfigured: true,
    });
    const result = await runPluginAdd('p1', deps);
    expect(result.exitCode).toBe(4);
  });

  test('rejects a plugin name not declared in the channel before invoking PluginManager', async () => {
    const { deps } = makeFakeDeps({ channel: makeChannel({ plugins: [] }) });
    let addCalled = false;
    deps.pluginManager.add = async () => {
      addCalled = true;
      return {
        success: true,
        compose: { exitCode: 0, dropsFileContent: '' },
        pluginSyncClassification: 'ok',
        doctorConfigured: true,
      };
    };
    const result = await runPluginAdd('not-declared', deps);
    expect(result.exitCode).not.toBe(0);
    expect(addCalled).toBe(false);
  });

  test('exits 1 when the Lockfile is absent (BR8.1)', async () => {
    const { deps } = makeFakeDeps({ lockfileState: 'absent' });
    const result = await runPluginAdd('p1', deps);
    expect(result.exitCode).toBe(1);
  });
});

describe('runPluginRemove (CommandLayer)', () => {
  test('exits 0 on success', async () => {
    const { deps } = makeFakeDeps({
      lockfile: makeLockfile({
        plugins: [
          {
            name: 'p1',
            ref: 'r',
            version: '1.0.0',
            sha256: 'x',
            composed_at: 't',
            engine_version_at_compose: '0.1.0',
          },
        ],
      }),
    });
    const result = await runPluginRemove('p1', deps);
    expect(result.exitCode).toBe(0);
  });

  test('rejects a plugin that is not currently placed before invoking PluginManager', async () => {
    const { deps } = makeFakeDeps({ lockfile: makeLockfile({ plugins: [] }) });
    let removeCalled = false;
    deps.pluginManager.remove = async () => {
      removeCalled = true;
      return {
        success: true,
        compose: { exitCode: 0, dropsFileContent: '' },
        pluginSyncClassification: 'ok',
        doctorConfigured: true,
      };
    };
    const result = await runPluginRemove('not-placed', deps);
    expect(result.exitCode).not.toBe(0);
    expect(removeCalled).toBe(false);
  });

  test('issue #14: notes when doctorConfigured is false on an otherwise successful remove', async () => {
    const { deps, logs } = makeFakeDeps({
      lockfile: makeLockfile({
        plugins: [
          {
            name: 'p1',
            ref: 'r',
            version: '1.0.0',
            sha256: 'x',
            composed_at: 't',
            engine_version_at_compose: '0.1.0',
          },
        ],
      }),
    });
    deps.pluginManager.remove = async () => ({
      success: true,
      compose: { exitCode: 0, dropsFileContent: '' },
      pluginSyncClassification: 'ok',
      doctorConfigured: false,
    });
    const result = await runPluginRemove('p1', deps);
    expect(result.exitCode).toBe(0);
    expect(logs.stdout.join('\n').toLowerCase()).toContain('not configured');
  });

  test('exits 4 when SuccessVerifier fails', async () => {
    const { deps } = makeFakeDeps({
      lockfile: makeLockfile({
        plugins: [
          {
            name: 'p1',
            ref: 'r',
            version: '1.0.0',
            sha256: 'x',
            composed_at: 't',
            engine_version_at_compose: '0.1.0',
          },
        ],
      }),
    });
    deps.pluginManager.remove = async () => ({
      success: false,
      compose: { exitCode: 1, dropsFileContent: '' },
      pluginSyncClassification: 'failure',
      doctorConfigured: true,
    });
    const result = await runPluginRemove('p1', deps);
    expect(result.exitCode).toBe(4);
  });
});
