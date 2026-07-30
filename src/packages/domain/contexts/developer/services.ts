/**
 * @file contexts/developer/services.ts
 * @package @eks-food/domain/contexts/developer
 *
 * Developer bounded context — domain service interfaces.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type {
  ISODateString,
  UUID,
} from '../../shared/value-objects';
import type {
  ApiKeyAggregate,
  WebhookAggregate,
  WebhookDeliveryAggregate,
} from './aggregates';
import type {
  ApiKeyPrefix,
  ApiScope,
  HashedApiKey,
} from './value-objects';

/**
 * Issues new API keys: generates a plaintext secret, hashes it and
 * returns both. The plaintext is returned exactly once; the
 * application layer is responsible for surfacing it to the caller.
 */
export interface ApiKeyIssuer {
  issue(
    tenantId: UUID,
    issuedTo: UUID,
    name: string,
    scopes: ReadonlyArray<ApiScope>,
    expiresAt: ISODateString | null,
    now: ISODateString,
  ): Promise<Result<{ aggregate: ApiKeyAggregate; plaintext: string }, DomainError>>;
  rotate(
    apiKeyId: UUID,
    rotatedBy: UUID,
    now: ISODateString,
  ): Promise<Result<{ aggregate: ApiKeyAggregate; plaintext: string }, DomainError>>;
}

/**
 * Verifies a presented API key against the stored hashes. Returns the
 * matching ApiKeyAggregate or null when no match exists.
 */
export interface ApiKeyVerifier {
  verify(plaintext: string): Promise<ApiKeyAggregate | null>;
  computeHash(plaintext: string): Promise<{ hash: HashedApiKey; prefix: ApiKeyPrefix }>;
}

/**
 * Dispatches a domain event to all interested webhooks. The
 * implementation lives in the application layer (it enqueues
 * deliveries onto a worker); this interface is the domain contract
 * used by other contexts.
 */
export interface WebhookDispatcher {
  dispatch(
    tenantId: UUID,
    eventType: string,
    payload: Readonly<Record<string, unknown>>,
    now: ISODateString,
  ): Promise<Result<ReadonlyArray<WebhookDeliveryAggregate>, DomainError>>;
  signPayload(
    webhook: WebhookAggregate,
    payload: Readonly<Record<string, unknown>>,
  ): string;
}

export type { UUID };
