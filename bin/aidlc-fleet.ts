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
import { hasFlag, positionals, readOption } from '../src/commands/argv';
import { buildRealDeps } from '../src/commands/real-deps';

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

Environment:
  AIDLC_FLEET_CHANNEL_URL   Channel declaration URL (required)
  AIDLC_FLEET_COMPOSE_CMD   Upstream compose command, space-separated (required for mutating commands)
  AIDLC_FLEET_DOCTOR_CMD    Upstream doctor command, space-separated (optional; unset means "no unaddressed failures")
`;

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const args0 = args[0];
  if (args.length === 0 || args0 === '--help' || args0 === '-h') {
    process.stdout.write(USAGE);
    return args.length === 0 ? 1 : 0;
  }

  const projectRoot = process.cwd();
  const channelUrl = process.env.AIDLC_FLEET_CHANNEL_URL ?? '';
  const composeCommand = (process.env.AIDLC_FLEET_COMPOSE_CMD ?? '').split(' ').filter(Boolean);
  const doctorCommand = (process.env.AIDLC_FLEET_DOCTOR_CMD ?? '').split(' ').filter(Boolean);
  if (!channelUrl) {
    process.stderr.write('aidlc-fleet: AIDLC_FLEET_CHANNEL_URL is not set.\n');
    return 1;
  }

  const deps = buildRealDeps({ projectRoot, channelUrl, composeCommand, doctorCommand });
  const [command, ...rest] = args;
  const pos = positionals(rest);

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
    case 'doctor': {
      const result = await runDoctor(deps);
      return result.exitCode;
    }
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
