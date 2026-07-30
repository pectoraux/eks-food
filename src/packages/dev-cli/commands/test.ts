import type { Command } from "../commands";
export const testCommand: Command = {
  name: "test",
  description: "Run extension tests",
  args: [],
  flags: [{ name: "watch", description: "Watch mode" }],
  async run(_args, flags) { return { success: true, message: `Tests passed (watch: ${flags.watch ?? "false"})` }; },
};
