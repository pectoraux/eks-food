/**
 * @file contexts/notifications/value-objects.ts
 * @package @eks-food/domain/contexts/notifications
 *
 * Notifications bounded context — value objects.
 */

export type {
  EmailAddress,
  ISODateString,
  LocalizedText,
  UUID,
} from '../../shared/value-objects';

import type {
  EmailAddress,
  ISODateString,
  LocalizedText,
  UUID,
} from '../../shared/value-objects';

/**
 * Branded primitive representing a channel type, e.g. `"email"`,
 * `"sms"`, `"push"`, `"in_app"`, `"whatsapp"`.
 */
export type NotificationChannelType = string & { readonly __brand: 'NotificationChannelType' };

/**
 * Branded primitive representing a stable template key, e.g.
 * `"booking.confirmed.v1"`.
 */
export type TemplateKey = string & { readonly __brand: 'TemplateKey' };

/**
 * Lifecycle states for a Notification.
 */
export type NotificationStatus =
  | 'PENDING'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'FAILED'
  | 'SUPPRESSED'
  | 'OPENED'
  | 'CLICKED';

/**
 * Lifecycle states for a Channel.
 */
export type ChannelStatus = 'ACTIVE' | 'DISABLED' | 'RATE_LIMITED';

/**
 * Lifecycle states for a Template.
 */
export type TemplateStatus = 'DRAFT' | 'PUBLISHED' | 'DEPRECATED';

/**
 * A recipient's verified channel endpoint (email address, phone,
 * device token, etc.).
 */
export interface ChannelEndpoint {
  readonly type: NotificationChannelType;
  readonly target: string;
  readonly verified: boolean;
  readonly verifiedAt: ISODateString | null;
}

/**
 * Addressed recipient descriptor.
 */
export interface NotificationRecipient {
  readonly recipientId: UUID;
  readonly email: EmailAddress | null;
  readonly phone: string | null;
  readonly deviceTokens: ReadonlyArray<string>;
  readonly preferredLocale: string;
}

/**
 * Variables passed to template rendering.
 */
export type TemplateVariables = Readonly<Record<string, string | number | boolean | null>>;

/**
 * Rendered notification payload (subject + body in one or more locales).
 */
export interface RenderedNotification {
  readonly subject: LocalizedText;
  readonly body: LocalizedText;
  readonly actionUrl?: string;
  readonly imageUrl?: string;
}

/**
 * Per-recipient preference flags.
 */
export interface NotificationPreferences {
  readonly channel: NotificationChannelType;
  readonly enabled: boolean;
  readonly quietHoursStart?: string;
  readonly quietHoursEnd?: string;
}
