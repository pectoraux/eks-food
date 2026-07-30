/** Command definitions for the Developer CLI. */
export interface Command {
  readonly name: string;
  readonly description: string;
  readonly args: readonly { readonly name: string; readonly required: boolean; readonly description: string }[];
  readonly flags: readonly { readonly name: string; readonly description: string; readonly default?: string }[];
  run(args: Record<string, string>, flags: Record<string, string>): Promise<CommandResult>;
}

export interface CommandResult {
  readonly success: boolean;
  readonly message: string;
  readonly data?: unknown;
}

import { createCommand } from "./commands/create";
import { validateCommand } from "./commands/validate";
import { buildCommand } from "./commands/build";
import { testCommand } from "./commands/test";
import { packageCommand } from "./commands/package";
import { installCommand } from "./commands/install";
import { publishCommand } from "./commands/publish";
import { upgradeCommand } from "./commands/upgrade";
import { manifestGenerateCommand } from "./commands/manifest-generate";
import { logsCommand } from "./commands/logs";
import { eventsReplayCommand } from "./commands/events-replay";

export const commands: readonly Command[] = [
  createCommand,
  validateCommand,
  buildCommand,
  testCommand,
  packageCommand,
  installCommand,
  publishCommand,
  upgradeCommand,
  manifestGenerateCommand,
  logsCommand,
  eventsReplayCommand,
];
