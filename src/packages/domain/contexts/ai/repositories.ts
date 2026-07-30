/**
 * @file contexts/ai/repositories.ts
 * @package @eks-food/domain/contexts/ai
 *
 * AI bounded context — repository interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  Page,
  PagedResult,
  UUID,
} from '../../shared/value-objects';
import type {
  AgentAggregate,
  CompletionAggregate,
  ConversationAggregate,
  PromptAggregate,
} from './aggregates';
import type { AgentType, ConversationStatus, PromptStatus } from './value-objects';

export interface ConversationListFilter {
  readonly tenantId?: UUID;
  readonly agentId?: UUID;
  readonly actorId?: UUID;
  readonly status?: ConversationStatus;
}

export interface ConversationRepository {
  findById(id: UUID): Promise<ConversationAggregate | null>;
  list(
    filter: ConversationListFilter,
    page: Page,
  ): Promise<PagedResult<ConversationAggregate>>;
  save(agg: ConversationAggregate): Promise<Result<void, DomainError>>;
}

export interface PromptRepository {
  findById(id: UUID): Promise<PromptAggregate | null>;
  listByConversation(conversationId: UUID): Promise<ReadonlyArray<PromptAggregate>>;
  list(
    filter: { status?: PromptStatus; from?: string; to?: string },
    page: Page,
  ): Promise<PagedResult<PromptAggregate>>;
  save(agg: PromptAggregate): Promise<Result<void, DomainError>>;
}

export interface CompletionRepository {
  findById(id: UUID): Promise<CompletionAggregate | null>;
  listByPrompt(promptId: UUID): Promise<ReadonlyArray<CompletionAggregate>>;
  save(agg: CompletionAggregate): Promise<Result<void, DomainError>>;
}

export interface AgentRepository {
  findById(id: UUID): Promise<AgentAggregate | null>;
  findActive(
    tenantId: UUID | null,
    agentType: AgentType,
  ): Promise<AgentAggregate | null>;
  list(
    filter: { tenantId?: UUID | null; agentType?: AgentType; active?: boolean },
    page: Page,
  ): Promise<PagedResult<AgentAggregate>>;
  save(agg: AgentAggregate): Promise<Result<void, DomainError>>;
}
