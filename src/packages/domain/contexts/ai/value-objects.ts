/**
 * @file contexts/ai/value-objects.ts
 * @package @eks-food/domain/contexts/ai
 *
 * AI bounded context — value objects.
 */

export type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';

import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';

/**
 * Lifecycle states for a Conversation.
 */
export type ConversationStatus = 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED';

/**
 * Lifecycle states for a Prompt.
 */
export type PromptStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * Role of a message author in a conversation.
 */
export type MessageRole = 'SYSTEM' | 'USER' | 'ASSISTANT' | 'TOOL';

/**
 * Branded primitive representing an AI provider name, e.g.
 * `"zai"`, `"openai"`, `"anthropic"`.
 */
export type AiProvider = string & { readonly __brand: 'AiProvider' };

/**
 * Branded primitive representing a model identifier, e.g.
 * `"glm-4.6"`, `"gpt-4o"`.
 */
export type ModelId = string & { readonly __brand: 'ModelId' };

/**
 * Branded primitive representing an agent type code, e.g.
 * `"booking.copilot"`, `"safety.advisor"`.
 */
export type AgentType = string & { readonly __brand: 'AgentType' };

/**
 * A single message in a conversation.
 */
export interface ChatMessage {
  readonly id: UUID;
  readonly role: MessageRole;
  readonly content: string;
  readonly createdAt: ISODateString;
  readonly toolCalls?: ReadonlyArray<ToolCall>;
  readonly toolCallId?: string;
}

/**
 * A request for a tool invocation by the model.
 */
export interface ToolCall {
  readonly id: UUID;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

/**
 * Result of a tool invocation.
 */
export interface ToolResult {
  readonly callId: UUID;
  readonly output: Readonly<Record<string, unknown>>;
  readonly isError: boolean;
}

/**
 * Token-usage accounting for a single completion.
 */
export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
}

/**
 * Configuration of an Agent (system prompt, tools, model).
 */
export interface AgentConfig {
  readonly agentType: AgentType;
  readonly model: ModelId;
  readonly provider: AiProvider;
  readonly systemPrompt: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly allowedTools: ReadonlyArray<string>;
  readonly version: string;
}
