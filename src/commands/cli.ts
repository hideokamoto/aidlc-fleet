/**
 * `aidlc-fleet` CLI orchestration — argv routing for all seven commands
 * (`components.md`'s `CommandLayer`) plus `config` (issue #18). Extracted
 * from `bin/aidlc-fleet.ts` (now a thin `runCli(process.argv, process.cwd())`
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
import { runConfig } from './config';
import { hasFlag, positionals, readOption, resolveHarness } from './argv';
import { buildRealDeps, buildConfigAccess } from './real-deps';

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
  config                    Prompt for and save any of the 4 env vars below that are still unset

Environment (issue #18: env > project-local .aidlc-fleet.local.json > built-in default > unset):
  AIDLC_FLEET_CHANNEL_URL   Channel declaration URL (required; no built-in default)
  AIDLC_FLEET_COMPOSE_CMD   Upstream compose command, space-separated (default: "bun .claude/tools/aidlc-orchestrate.ts next compose")
  AIDLC_FLEET_DOCTOR_CMD    Upstream doctor command, space-separated (default: "bun .claude/tools/aidlc-utility.ts doctor")
  AIDLC_FLEET_ENGINE_REPO   "owner/name" GitHub repo the engine tarball is fetched from (default: "awslabs/aidlc-workflows")

Run "aidlc-fleet config" to answer AIDLC_FLEET_CHANNEL_URL once and save it to
.aidlc-fleet.local.json (gitignored) instead of re-exporting it every session.
`;

export async function runCli(argv: string[], projectRoot: string): Promise<number> {
  const args0 = argv[0];
  if (argv.length === 0 || args0 === '--help' || args0 === '-h') {
    process.stdout.write(USAGE);
    return argv.length === 0 ? 1 : 0;
  }

  const configAccess = buildConfigAccess(projectRoot);
  const resolvedConfig = await configAccess.resolveAll();
  const channelUrl = resolvedConfig.AIDLC_FLEET_CHANNEL_URL.value ?? '';
  const composeCommand = (resolvedConfig.AIDLC_FLEET_COMPOSE_CMD.value ?? '')
    .split(' ')
    .filter(Boolean);
  const doctorCommand = (resolvedConfig.AIDLC_FLEET_DOCTOR_CMD.value ?? '')
    .split(' ')
    .filter(Boolean);
  const engineRepo = resolvedConfig.AIDLC_FLEET_ENGINE_REPO.value ?? '';
  const [command, ...rest] = argv;
  const pos = positionals(rest);

  // `config` is the one command that must run even when AIDLC_FLEET_CHANNEL_URL
  // is unset — it is how a user answers it in the first place. `doctor`
  // must run too: it never calls `channelClient.fetchChannel()`, and its
  // whole point (issue #18) is to report an unset variable as a
  // diagnosable failure instead of the CLI bailing out before doctor ever
  // gets a chance to say so (code-review finding).
  if (command === 'config' || command === 'doctor') {
    const deps = buildRealDeps({
      projectRoot,
      channelUrl,
      composeCommand,
      doctorCommand,
      engineRepo,
    });
    const result = command === 'config' ? await runConfig(deps) : await runDoctor(deps);
    return result.exitCode;
  }

  if (!channelUrl) {
    process.stderr.write(
      'aidlc-fleet: AIDLC_FLEET_CHANNEL_URL is not set. Run "aidlc-fleet config" to set it once, or export it.\n',
    );
    return 1;
  }
  // Only init/update actually fetch the engine tarball; other commands
  // (status, pin, plugin) never need engineRepo, so it is not gated here
  // — buildTarballUrl throws with a clear message if an engine fetch is
  // attempted without it.
  const deps = buildRealDeps({
    projectRoot,
    channelUrl,
    composeCommand,
    doctorCommand,
    engineRepo,
  });

  switch (command) {
    case 'init': {
      // issue #15: an omitted `--harness` used to fall back to "claude"
      // with no signal at all — a Cursor (or other non-Claude-Code)
      // project that forgot the flag got the engine silently placed under
      // `.claude/` instead of the harness it actually uses. Keep the
      // convenient default (removing it outright would make every bare
      // `init` fail even for the common Claude Code case), but make the
      // fallback loud so the omission is visible at the point it happens.
      if (readOption(rest, 'harness') === undefined) {
        process.stderr.write(
          `aidlc-fleet: --harness not specified; defaulting to "${resolveHarness(rest)}". ` +
            'If this project uses a different AI coding harness (e.g. "cursor"), pass ' +
            '--harness <name> explicitly, or the engine will be placed in the wrong directory.\n',
        );
      }
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
    // 'doctor' is handled earlier (before the channelUrl gate) — see above.
    default:
      process.stdout.write(USAGE);
      return 1;
  }
}
