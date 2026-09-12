#!/usr/bin/env bun
/**
 * `aidlc-fleet` CLI entrypoint — argv routing for all seven commands
 * (`components.md`'s `CommandLayer`). Parses `process.argv`, wires the
 * real `CommandDeps` bundle (`src/commands/real-deps.ts`), dispatches to
 * the matching command module, and exits with the mapped code (M8).
 */
import { runInit } from '../src/commands/init';
import { runUpdate } from '../src/commands/update';
import { runCheck } from '../src/commands/check';
import { runPluginAdd, runPluginRemove } from '../src/commands/plugin';
import { runPin, runUnpin } from '../src/commands/pin';
import { runStatus } from '../src/commands/status';
import { runDoctor } from '../src/commands/doctor';
import { runConfig } from '../src/commands/config';
import { hasFlag, positionals, readOption } from '../src/commands/argv';
import { buildRealDeps, buildConfigAccess } from '../src/commands/real-deps';

const USAGE = `aidlc-fleet <command> [options]

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

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const args0 = args[0];
  if (args.length === 0 || args0 === '--help' || args0 === '-h') {
    process.stdout.write(USAGE);
    return args.length === 0 ? 1 : 0;
  }

  const projectRoot = process.cwd();
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
  const [command, ...rest] = args;
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
  // (status, doctor, pin, plugin) never need engineRepo, so it is not
  // gated here — buildTarballUrl throws with a clear message if an
  // engine fetch is attempted without it.
  const deps = buildRealDeps({
    projectRoot,
    channelUrl,
    composeCommand,
    doctorCommand,
    engineRepo,
  });

  switch (command) {
    case 'init': {
      const result = await runInit(
        {
          adopt: hasFlag(rest, 'adopt'),
          harness: readOption(rest, 'harness') ?? 'claude-code',
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

main()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((err) => {
    process.stderr.write(
      `aidlc-fleet: fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
