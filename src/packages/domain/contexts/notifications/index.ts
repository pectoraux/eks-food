/**
 * @file contexts/notifications/index.ts
 * @package @eks-food/domain/contexts/notifications
 *
 * Notifications bounded context barrel.
 *
 * The notifications context is a subscriber to most other contexts
 * (booking, payments, safety, etc.) and turns domain events into
 * human-facing messages. It owns notifications, channels (delivery
 * integrations) and templates (versioned, localised content).
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
