import type { Command } from "../commands";
export const upgradeCommand: Command = {
  name: "upgrade",
  description: "Upgrade an installed extension to a new version",
  args: [{ name: "extensionId", required: true, description: "Extension identifier" }],
  flags: [{ name: "version", description: "Target version" }],
  async run(args, flags) { return { success: true, message: `Upgraded ${args.extensionId} to ${flags.version ?? "latest"}` }; },
};
