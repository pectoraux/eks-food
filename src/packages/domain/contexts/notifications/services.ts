/**
 * @file contexts/notifications/services.ts
 * @package @eks-food/domain/contexts/notifications
 *
 * Notifications bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { UUID } from '../../shared/value-objects';
import type { NotificationAggregate } from './aggregates';
import type {
  NotificationRecipient,
  RenderedNotification,
  TemplateKey,
  TemplateVariables,
} from './value-objects';

/**
 * Renders a template with the given variables into a
 * {@link RenderedNotification}. The implementation lives in the
 * application layer; this interface is the domain contract.
 */
export interface TemplateRenderer {
  render(
    templateKey: TemplateKey,
    channel: string,
    locale: string,
    variables: TemplateVariables,
  ): Promise<Result<RenderedNotification, DomainError>>;
}

/**
 * Decides whether a notification should be sent to a recipient given
 * their preferences, quiet hours and rate limits. Returns `false`
 * when the notification should be suppressed (and the caller records
 * a `SUPPRESSED` status).
 */
export interface NotificationPolicyService {
  shouldSend(
    recipient: NotificationRecipient,
    templateKey: TemplateKey,
    channel: string,
    now: Date,
  ): Promise<{ send: boolean; reason?: string }>;
  nextAllowedSlot(
    recipientId: UUID,
    channel: string,
    now: Date,
  ): Promise<Date | null>;
}

/**
 * Composes a NotificationAggregate from a triggering event payload
 * (the subscriber-facing entry point of the context).
 */
export interface NotificationComposer {
  compose(
    tenantId: UUID,
    recipient: NotificationRecipient,
    templateKey: TemplateKey,
    variables: TemplateVariables,
    correlationId: UUID,
  ): Promise<Result<NotificationAggregate, DomainError>>;
}
