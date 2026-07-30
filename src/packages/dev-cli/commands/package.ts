import type { Command } from "../commands";
import { Packager } from "@eks/registry";
export const packageCommand: Command = {
  name: "package",
  description: "Package an extension into a signed artifact",
  args: [],
  flags: [{ name: "key", description: "Signing private key" }],
  async run(_args, flags) {
    const p = new Packager();
    const result = await p.pack({ extensionId: "local", version: "0.0.0", source: "{}", privateKey: flags.key });
    return { success: true, message: `Packaged: checksum=${result.checksum.slice(0, 16)}… size=${result.sizeBytes}B`, data: result };
  },
};
