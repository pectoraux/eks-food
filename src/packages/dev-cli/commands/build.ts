import type { Command } from "../commands";
export const buildCommand: Command = {
  name: "build",
  description: "Build an extension for packaging",
  args: [],
  flags: [{ name: "out", description: "Output directory", default: "dist" }],
  async run(_args, flags) { return { success: true, message: `Built to ${flags.out}`, data: { out: flags.out } }; },
};
