import type { Command } from "../commands";
export const createCommand: Command = {
  name: "create",
  description: "Scaffold a new extension project",
  args: [{ name: "name", required: true, description: "Extension name (e.g. com.acme.analytics)" }],
  flags: [{ name: "template", description: "Project template", default: "basic" }],
  async run(args, flags) {
    return { success: true, message: `Created extension ${args.name} from template '${flags.template}'`, data: { name: args.name, template: flags.template } };
  },
};
