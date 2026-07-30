import type { Command } from "../commands";
export const logsCommand: Command = {
  name: "logs",
  description: "Inspect extension logs",
  args: [{ name: "extensionId", required: false, description: "Extension identifier" }],
  flags: [{ name: "level", description: "Filter by level" }, { name: "follow", description: "Follow mode" }],
  async run(args, flags) { return { success: true, message: `Logs for ${args.extensionId ?? "all"} (level: ${flags.level ?? "all"})` }; },
};
