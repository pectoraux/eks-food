/**
 * @eks/dev-cli — the Developer CLI.
 *
 * Commands: create, validate, build, test, package, install, publish, upgrade,
 * manifest:generate, logs, events:replay. Designed to be invoked from the
 * terminal (`eks <command>`) or programmatically.
 *
 * The CLI is a thin orchestrator over the @eks/registry + @eks/runtime packages.
 */
export { runCommand, type CommandResult } from "./cli";
export { commands, type Command } from "./commands";
