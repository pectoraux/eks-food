/** The extension entrypoint interface that extension authors implement. */
import type { ExtensionContext } from "@eks/sdk";

export interface ExtensionModule {
  /** The manifest (must match the package manifest). */
  readonly manifest: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  };
  /** Called when the extension is activated. Register capabilities here. */
  activate(ctx: ExtensionContext): Promise<void> | void;
  /** Called when the extension is deactivated (graceful shutdown). */
  deactivate?(): Promise<void> | void;
  /** Optional health check. */
  healthCheck?(ctx: ExtensionContext): Promise<{ healthy: boolean; detail?: string }>;
}

export type ExtensionEntrypoint = () => ExtensionModule | Promise<ExtensionModule>;
