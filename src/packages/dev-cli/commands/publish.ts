import type { Command } from "../commands";
export const publishCommand: Command = {
  name: "publish",
  description: "Publish an extension version to the registry",
  args: [],
  flags: [{ name: "registry", description: "Registry URL", default: "https://registry.eks-food.com" }],
  async run(_args, flags) { return { success: true, message: `Published to ${flags.registry}` }; },
};
