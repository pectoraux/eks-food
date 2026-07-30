/** CLI runner — dispatches to the right command. */
import { commands, type Command } from "./commands";

export interface CommandResult {
  readonly success: boolean;
  readonly message: string;
  readonly data?: unknown;
}

export async function runCommand(argv: string[]): Promise<CommandResult> {
  const [cmdName, ...rest] = argv;
  const cmd = commands.find((c) => c.name === cmdName);
  if (!cmd) {
    return {
      success: false,
      message: `Unknown command: ${cmdName}. Available: ${commands.map((c) => c.name).join(", ")}`,
    };
  }
  // Parse args + flags (simplified: --flag value, positional args by order).
  const args: Record<string, string> = {};
  const flags: Record<string, string> = {};
  let argIdx = 0;
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token.startsWith("--")) {
      const flagName = token.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        flags[flagName] = next;
        i++;
      } else {
        flags[flagName] = "true";
      }
    } else {
      const argDef = cmd.args[argIdx];
      if (argDef) args[argDef.name] = token;
      argIdx++;
    }
  }
  // Apply flag defaults.
  for (const f of cmd.flags) {
    if (!(f.name in flags) && f.default !== undefined) flags[f.name] = f.default;
  }
  return cmd.run(args, flags);
}
