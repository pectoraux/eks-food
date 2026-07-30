/**
 * @file contexts/ai/events.ts
 * @package @eks-food/domain/contexts/ai
 *
 * AI bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for AI conversations, prompts,
 *    completions and agents. Used for audit, billing and observability
 *    of every LLM call in the platform.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface ConversationStartedEvent extends DomainEvent {
  readonly eventType: 'ai.conversation.started.v1';
  readonly agentId: UUID;
  readonly actorId: UUID;
  readonly startedAt: ISODateString;
}

export interface PromptSubmittedEvent extends DomainEvent {
  readonly eventType: 'ai.prompt.submitted.v1';
  readonly conversationId: UUID;
  readonly promptId: UUID;
  readonly tokenCount: number;
  readonly submittedAt: ISODateString;
}

export interface CompletionProducedEvent extends DomainEvent {
  readonly eventType: 'ai.completion.produced.v1';
  readonly promptId: UUID;
  readonly model: string;
  readonly tokenCount: number;
  readonly latencyMs: number;
  readonly producedAt: ISODateString;
}

export interface AgentDeployedEvent extends DomainEvent {
  readonly eventType: 'ai.agent.deployed.v1';
  readonly agentType: string;
  readonly agentVersion: string;
  readonly deployedAt: ISODateString;
}
