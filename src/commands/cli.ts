/**
 * `aidlc-fleet` CLI orchestration — argv routing for all seven commands
 * (`components.md`'s `CommandLayer`). Extracted from `bin/aidlc-fleet.ts`
 * (which is now a thin `runCli(process.argv, process.env, process.cwd())`
 * wrapper) so this routing/env-wiring gets test coverage under `bun test
 * src/`. `bin/` was previously untested entirely — that is exactly how
 * the `--harness` default mismatch ("claude-code" vs the
 * `plugin-targets.json` key "claude") shipped and broke every bare `init`
 * undetected (see `cli.test.ts`).
 */
import { runInit } from './init';
import { runUpdate } from './update';
import { runCheck } from './check';
import { runPluginAdd, runPluginRemove } from './plugin';
import { runPin, runUnpin } from './pin';
import { runStatus } from './status';
import { runDoctor } from './doctor';
import { hasFlag, positionals, resolveHarness } from './argv';
import { buildRealDeps } from './real-deps';

export const USAGE = `aidlc-fleet <command> [options]

Commands:
  init [--adopt] [--harness <name>] [--force]
  update [--acknowledge-migration]
  check
  plugin add <name>
  plugin remove <name>
  pin <ref>
  unpin
  status
  doctor

Environment:
  AIDLC_FLEET_CHANNEL_URL   Channel declaration URL (required)
  AIDLC_FLEET_COMPOSE_CMD   Upstream compose command, space-separated (required for mutating commands)
  AIDLC_FLEET_DOCTOR_CMD    Upstream doctor command, space-separated (optional; unset means "no unaddressed failures")
  AIDLC_FLEET_ENGINE_REPO   "owner/name" GitHub repo the engine tarball is fetched from (required for init/update)
`;

/** Env shape this CLI reads from; a subset of `NodeJS.ProcessEnv` so tests can pass a plain object. */
export type CliEnv = Record<string, string | undefined>;

export async function runCli(argv: string[], env: CliEnv, projectRoot: string): Promise<number> {
  const args0 = argv[0];
  if (argv.length === 0 || args0 === '--help' || args0 === '-h') {
    process.stdout.write(USAGE);
    return argv.length === 0 ? 1 : 0;
  }

  const channelUrl = env.AIDLC_FLEET_CHANNEL_URL ?? '';
  const composeCommand = (env.AIDLC_FLEET_COMPOSE_CMD ?? '').split(' ').filter(Boolean);
  const doctorCommand = (env.AIDLC_FLEET_DOCTOR_CMD ?? '').split(' ').filter(Boolean);
  const engineRepo = env.AIDLC_FLEET_ENGINE_REPO ?? '';
  if (!channelUrl) {
    process.stderr.write('aidlc-fleet: AIDLC_FLEET_CHANNEL_URL is not set.\n');
    return 1;
  }
  // Only init/update actually fetch the engine tarball; other commands
  // (status, doctor, pin, plugin) never need engineRepo, so it is not
  // gated here — buildTarballUrl throws with a clear message if an
  // engine fetch is attempted without it.
  const deps = buildRealDeps({ projectRoot, channelUrl, composeCommand, doctorCommand, engineRepo });
  const [command, ...rest] = argv;
  const pos = positionals(rest);

  switch (command) {
    case 'init': {
      const result = await runInit(
        {
          adopt: hasFlag(rest, 'adopt'),
          harness: resolveHarness(rest),
          force: hasFlag(rest, 'force'),
        },
        deps,
      );
      return result.exitCode;
    }
    case 'update': {
      const result = await runUpdate(
        { acknowledgeMigration: hasFlag(rest, 'acknowledge-migration') },
        deps,
      );
      return result.exitCode;
    }
    case 'check': {
      const result = await runCheck(deps);
      return result.exitCode;
    }
    case 'plugin': {
      const [sub, name] = pos;
      if (sub === 'add' && name) {
        const result = await runPluginAdd(name, deps);
        return result.exitCode;
      }
      if (sub === 'remove' && name) {
        const result = await runPluginRemove(name, deps);
        return result.exitCode;
      }
      process.stderr.write(
        'aidlc-fleet: expected "plugin add <name>" or "plugin remove <name>".\n',
      );
      return 1;
    }
    case 'pin': {
      const [ref] = pos;
      if (!ref) {
        process.stderr.write('aidlc-fleet: expected "pin <ref>".\n');
        return 1;
      }
      const result = await runPin(ref, deps);
      return result.exitCode;
    }
    case 'unpin': {
      const result = await runUnpin(deps);
      return result.exitCode;
    }
    case 'status': {
      const result = await runStatus(deps);
      return result.exitCode;
    }
    case 'doctor': {
      const result = await runDoctor(deps);
      return result.exitCode;
    }
    default:
      process.stdout.write(USAGE);
      return 1;
  }
}
