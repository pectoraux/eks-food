import type { Command } from "../commands";
export const manifestGenerateCommand: Command = {
  name: "manifest:generate",
  description: "Generate a manifest template",
  args: [],
  flags: [{ name: "name", description: "Extension name", default: "com.example.my-extension" }],
  async run(_args, flags) {
    const template = { metadata: { id: flags.name, name: "My Extension", version: "0.1.0", description: "An Eks-Food extension", publisher: "example" }, capabilities: [], permissions: [], requiredAPIs: [], requiredEvents: [], configurationSchema: {}, connectorDependencies: [], compatibility: { platformRange: ">=1.0.0" } };
    return { success: true, message: `Generated manifest template for ${flags.name}`, data: template };
  },
};
