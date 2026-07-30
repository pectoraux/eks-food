/**
 * @file contexts/restaurant/events.ts
 * @package @eks-food/domain/contexts/restaurant
 *
 * Restaurant bounded context — domain events.
 *
 * Responsibility:
 *  - Capture lifecycle events for restaurants and their menus.
 */

import type { DomainEvent } from '../../shared/domain-event';
import type { ISODateString, UUID } from '../../shared/value-objects';

export interface RestaurantOnboardedEvent extends DomainEvent {
  readonly eventType: 'restaurant.onboarded.v1';
  readonly tenantId: UUID;
  readonly name: string;
  readonly onboardedAt: ISODateString;
}

export interface RestaurantActivatedEvent extends DomainEvent {
  readonly eventType: 'restaurant.activated.v1';
  readonly activatedAt: ISODateString;
}

export interface MenuPublishedEvent extends DomainEvent {
  readonly eventType: 'restaurant.menu.published.v1';
  readonly menuId: UUID;
  readonly itemCount: number;
}

export interface MenuItemPriceChangedEvent extends DomainEvent {
  readonly eventType: 'restaurant.menu.item.price.changed.v1';
  readonly itemId: UUID;
  readonly previousPrice: number;
  readonly newPrice: number;
}
