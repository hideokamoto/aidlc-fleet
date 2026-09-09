/**
 * `init` command — `functional-spec.md`'s `init` workflow. No business
 * logic: parses/receives options, dispatches to `ChannelClient` and
 * `EngineInstaller`, maps the outcome to the M8 exit-code contract.
 */
import { exitCodeForInstall } from '../core/exit-code';
import type { CommandDeps, CommandResult } from './types';

export interface InitOptions {
  adopt: boolean;
  harness: string;
  force: boolean;
}

/** `init`: no VersionGate check on first init (the gate only applies to `update`). */
export async function runInit(options: InitOptions, deps: CommandDeps): Promise<CommandResult> {
  const channel = await deps.channelClient.fetchChannel();
  const result = await deps.engineInstaller.install(channel.engine, {
    harness: options.harness,
    force: options.force,
    isFirstInit: true,
    adopt: options.adopt,
  });

  if (result.success) {
    deps.stdout(`init: engine ${channel.engine.ref} placed successfully.`);
  } else {
    deps.stderr('init: install did not pass the four-part success criterion.');
  }

  return { exitCode: exitCodeForInstall(result.success) };
}
