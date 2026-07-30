/**
 * @eks/workflow — workflow abstractions.
 *
 * Workflows are multi-step automations with triggers, actions, branching,
 * conditions, retries, compensation, parallel execution, human approval hooks,
 * and timeout handling. The workflow editor UI ships in a later milestone.
 */
export type { Workflow, WorkflowStep, WorkflowTrigger, WorkflowContext, WorkflowExecutionResult } from "./types";
export { WorkflowEngine } from "./engine";
export { type StepAction, type Condition, type Branch } from "./types";
