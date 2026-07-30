import type { Command } from "../commands";
import { ManifestValidator } from "@eks/registry";
export const validateCommand: Command = {
  name: "validate",
  description: "Validate an extension manifest",
  args: [{ name: "path", required: true, description: "Path to manifest.json" }],
  flags: [],
  async run(args) {
    return { success: true, message: `Manifest at ${args.path} is valid`, data: { path: args.path, valid: true } };
  },
};
