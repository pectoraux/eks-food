/**
 * @file contexts/ai/services.ts
 * @package @eks-food/domain/contexts/ai
 *
 * AI bounded context — domain service interfaces.
 *
 * NOTE: The actual LLM provider orchestration (Z.AI SDK calls, model
 * routing, retry policies, streaming) lives in the ai connector
 * package. This file declares domain services that operate on the
 * local aggregates (composition, accounting, guardrails).
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { UUID } from '../../shared/value-objects';
import type {
  AgentAggregate,
  CompletionAggregate,
  ConversationAggregate,
  PromptAggregate,
} from './aggregates';
import type { AgentConfig, ChatMessage, ModelId, ToolResult } from './value-objects';

/**
 * Composes the next message list to send to the model, applying
 * system prompt injection, token budgeting and tool-result threading.
 */
export interface ConversationComposer {
  compose(
    conversation: ConversationAggregate,
    agent: AgentAggregate,
    newUserMessage: ChatMessage,
  ): Result<ReadonlyArray<ChatMessage>, DomainError>;
  trimToTokenBudget(
    messages: ReadonlyArray<ChatMessage>,
    maxTokens: number,
  ): Result<ReadonlyArray<ChatMessage>, DomainError>;
}

/**
 * Selects the best model for a given agent and prompt, balancing
 * cost, latency and capability. Implementation lives in the
 * application layer.
 */
export interface ModelRouter {
  select(
    agent: AgentAggregate,
    prompt: PromptAggregate,
  ): Promise<Result<ModelId, DomainError>>;
  estimateCost(
    model: ModelId,
    promptTokens: number,
    completionTokens: number,
  ): Result<number, DomainError>;
}

/**
 * Applies safety guardrails to a produced completion (PII redaction,
 * content moderation, tool-call schema validation). May return a
 * failure result that the caller surfaces as a failed prompt.
 */
export interface CompletionGuardrail {
  validate(
    completion: CompletionAggregate,
    agent: AgentAggregate,
  ): Result<ReadonlyArray<ToolResult>, DomainError>;
  redact(content: string): string;
}

export type { AgentConfig };
