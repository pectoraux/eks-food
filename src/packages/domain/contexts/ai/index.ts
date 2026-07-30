/**
 * @file contexts/ai/index.ts
 * @package @eks-food/domain/contexts/ai
 *
 * AI bounded context barrel.
 *
 * The ai context owns conversations, prompts, completions and agents.
 * It is the platform's "AI-native" spine: every role-aware copilot
 * (cook workspace, admin console, customer assistant) is modelled as
 * an Agent here. LLM provider orchestration lives in the ai
 * connector package.
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
