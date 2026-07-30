/**
 * @file contexts/ai/aggregates.ts
 * @package @eks-food/domain/contexts/ai
 *
 * AI bounded context — aggregate root interfaces.
 */

import type { AggregateRoot } from '../../shared/entity';
import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  AgentConfig,
  AgentType,
  ChatMessage,
  ConversationStatus,
  ModelId,
  PromptStatus,
  TokenUsage,
  ToolResult,
} from './value-objects';

/**
 * Aggregate root representing a multi-turn Conversation between an
 * actor and an Agent.
 */
export interface ConversationAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'ConversationAggregate';
  readonly tenantId: UUID;
  readonly agentId: UUID;
  readonly actorId: UUID;
  readonly status: ConversationStatus;
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly startedAt: ISODateString;
  readonly lastActivityAt: ISODateString;
  readonly totalTokenUsage: TokenUsage;

  appendMessage(message: ChatMessage, now: ISODateString): Result<void, DomainError>;
  pause(reason: string): Result<void, DomainError>;
  resume(): Result<void, DomainError>;
  close(now: ISODateString): Result<void, DomainError>;
  archive(): Result<void, DomainError>;
  accumulateUsage(usage: TokenUsage): Result<void, DomainError>;
}

/**
 * Aggregate root representing a single Prompt submission (one user
 * turn that may produce one or more completions).
 */
export interface PromptAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'PromptAggregate';
  readonly conversationId: UUID;
  readonly status: PromptStatus;
  readonly submittedAt: ISODateString;
  readonly completedAt: ISODateString | null;
  readonly model: ModelId | null;
  readonly usage: TokenUsage | null;
  readonly latencyMs: number | null;
  readonly failureReason: string | null;

  start(now: ISODateString): Result<void, DomainError>;
  complete(
    model: ModelId,
    usage: TokenUsage,
    latencyMs: number,
    now: ISODateString,
  ): Result<void, DomainError>;
  fail(reason: string, now: ISODateString): Result<void, DomainError>;
  cancel(reason: string): Result<void, DomainError>;
}

/**
 * Aggregate root representing a single Completion (model output for
 * a Prompt). Carved out so a single prompt can have multiple
 * completions (n > 1 sampling, retries).
 */
export interface CompletionAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'CompletionAggregate';
  readonly promptId: UUID;
  readonly model: ModelId;
  readonly content: string;
  readonly usage: TokenUsage;
  readonly toolResults: ReadonlyArray<ToolResult>;
  readonly producedAt: ISODateString;

  appendToolResult(result: ToolResult): Result<void, DomainError>;
}

/**
 * Aggregate root representing an Agent: a configured deployment of
 * an LLM with a system prompt, tools and model.
 */
export interface AgentAggregate extends AggregateRoot<UUID> {
  readonly aggregateType: 'AgentAggregate';
  readonly tenantId: UUID | null;
  readonly agentType: AgentType;
  readonly config: AgentConfig;
  readonly active: boolean;
  readonly deployedAt: ISODateString;
  readonly retiredAt: ISODateString | null;

  deploy(config: AgentConfig, now: ISODateString): Result<void, DomainError>;
  retire(now: ISODateString): Result<void, DomainError>;
  updateConfig(patch: Partial<AgentConfig>): Result<void, DomainError>;
}
