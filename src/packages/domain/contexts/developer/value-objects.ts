/**
 * @file contexts/developer/value-objects.ts
 * @package @eks-food/domain/contexts/developer
 *
 * Developer bounded context — value objects.
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
 * Lifecycle states for an ApiKey.
 */
export type ApiKeyStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

/**
 * Lifecycle states for a Webhook.
 */
export type WebhookStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED';

/**
 * Lifecycle states for an Integration.
 */
export type IntegrationStatus =
  | 'PENDING_AUTH'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'SUSPENDED'
  | 'ERROR';

/**
 * Lifecycle states for a single WebhookDelivery.
 */
export type WebhookDeliveryStatus =
  | 'PENDING'
  | 'DELIVERED'
  | 'FAILED'
  | 'SKIPPED';

/**
 * Branded primitive representing a permission scope, e.g.
 * `"bookings:write"`.
 */
export type ApiScope = string & { readonly __brand: 'ApiScope' };

/**
 * Branded primitive representing an opaque API key prefix (the
 * visible portion of a key, e.g. `"eks_live_abc..."`).
 */
export type ApiKeyPrefix = string & { readonly __brand: 'ApiKeyPrefix' };

/**
 * Branded primitive representing a hashed API key secret. Only the
 * hash is stored; the plaintext is shown once at issue time.
 */
export type HashedApiKey = string & { readonly __brand: 'HashedApiKey' };

/**
 * Branded primitive representing a webhook signing secret (used to
 * sign outgoing payloads so receivers can verify authenticity).
 */
export type WebhookSigningSecret = string & { readonly __brand: 'WebhookSigningSecret' };

/**
 * Branded primitive representing an integration provider code, e.g.
 * `"payswap"`, `"zai"`, `"twilio"`.
 */
export type IntegrationProvider = string & { readonly __brand: 'IntegrationProvider' };

/**
 * A single delivery attempt for a webhook.
 */
export interface WebhookDeliveryAttempt {
  readonly id: UUID;
  readonly attemptNumber: number;
  readonly httpStatus: number | null;
  readonly responseBody: string | null;
  readonly durationMs: number;
  readonly error: string | null;
  readonly attemptedAt: ISODateString;
}

/**
 * Webhook registration shape.
 */
export interface WebhookConfig {
  readonly url: string;
  readonly eventTypes: ReadonlyArray<string>;
  readonly signingSecret: WebhookSigningSecret;
  readonly maxRetries: number;
  readonly retryBackoffSeconds: number;
}

/**
 * Integration credentials (stored encrypted; the domain only sees the
 * opaque shape).
 */
export interface IntegrationCredentials {
  readonly provider: IntegrationProvider;
  readonly externalId: string;
  readonly scopes: ReadonlyArray<ApiScope>;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly connectedAt: ISODateString;
  readonly expiresAt: ISODateString | null;
}
