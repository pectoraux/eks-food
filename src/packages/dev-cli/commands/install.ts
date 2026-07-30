import type { Command } from "../commands";
export const installCommand: Command = {
  name: "install",
  description: "Install an extension to an organization",
  args: [{ name: "extensionId", required: true, description: "Extension identifier" }],
  flags: [{ name: "version", description: "Version to install", default: "latest" }, { name: "org", description: "Organization ID" }],
  async run(args, flags) { return { success: true, message: `Installed ${args.extensionId}@${flags.version} to org ${flags.org}` }; },
};
