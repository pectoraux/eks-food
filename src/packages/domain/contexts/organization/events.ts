/**
 * @file contexts/organization/events.ts
 * @package @eks-food/domain/contexts/organization
 *
 * Organization bounded context — domain events.
 *
 * Responsibility:
 *  - Capture the lifecycle events of organisations (tenants), their
 *    memberships and the hierarchical tenant tree. Other contexts
 *    subscribe to these events to provision per-tenant projections
 *    (cook rosters, payment ledgers, feature flags, etc.).
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

/**
 * Raised when a new Organisation (tenant) is provisioned on the platform.
 */
export interface OrganizationProvisionedEvent extends DomainEvent {
  readonly eventType: 'organization.provisioned.v1';
  readonly name: string;
  readonly parentOrganizationId: UUID | null;
  readonly slug: string;
}

/**
 * Raised when a User is added as a member of an Organisation with an
 * initial role.
 */
export interface MemberAddedEvent extends DomainEvent {
  readonly eventType: 'organization.member.added.v1';
  readonly userId: UUID;
  readonly roleId: UUID;
  readonly addedAt: ISODateString;
}

/**
 * Raised when a member's role within an organisation is changed.
 */
export interface MemberRoleChangedEvent extends DomainEvent {
  readonly eventType: 'organization.member.role.changed.v1';
  readonly userId: UUID;
  readonly previousRoleId: UUID;
  readonly newRoleId: UUID;
  readonly changedAt: ISODateString;
}

/**
 * Raised when an Organisation is suspended (e.g. for non-payment or
 * compliance violation). Downstream contexts should degrade gracefully.
 */
export interface OrganizationSuspendedEvent extends DomainEvent {
  readonly eventType: 'organization.suspended.v1';
  readonly reason: string;
  readonly suspendedAt: ISODateString;
}
