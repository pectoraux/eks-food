import type { ExtensionContext } from "@eks/sdk";

export type WorkflowTrigger =
  | { readonly type: "event"; readonly eventType: string; readonly filter?: Record<string, unknown> }
  | { readonly type: "schedule"; readonly cron: string }
  | { readonly type: "manual" }
  | { readonly type: "webhook"; readonly path: string };

export interface Condition {
  readonly field: string; // dot-notation path in the workflow state
  readonly op: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "in" | "contains";
  readonly value: unknown;
}

export interface Branch {
  readonly condition: Condition;
  readonly then: string; // step id
  readonly otherwise?: string; // step id
}

export interface StepAction {
  readonly type: "api-call" | "event-publish" | "transform" | "delay" | "approval" | "parallel";
  readonly config: Record<string, unknown>;
}

export interface WorkflowStep {
  readonly id: string;
  readonly name: string;
  readonly action: StepAction;
  readonly branches?: readonly Branch[];
  readonly retry?: { readonly maxAttempts: number; readonly baseDelayMs: number };
  readonly timeout?: number;
  readonly compensation?: string; // step id to run on failure
  readonly next?: string; // next step id
}

export interface Workflow {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly trigger: WorkflowTrigger;
  readonly steps: readonly WorkflowStep[];
  readonly initialStep: string;
}

export interface WorkflowContext {
  readonly workflowId: string;
  readonly executionId: string;
  readonly organizationId: string;
  readonly sdk: ExtensionContext;
  /** Mutable workflow state (variables). */
  state: Record<string, unknown>;
  /** Steps completed so far. */
  completedSteps: string[];
  /** Steps that failed. */
  failedSteps: string[];
}

export interface WorkflowExecutionResult {
  readonly status: "COMPLETED" | "FAILED" | "TIMED_OUT" | "CANCELLED" | "AWAITING_APPROVAL";
  readonly completedSteps: readonly string[];
  readonly failedSteps: readonly string[];
  readonly state: Record<string, unknown>;
  readonly error?: string;
  readonly durationMs: number;
}
