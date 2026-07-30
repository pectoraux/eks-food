/**
 * @file index.ts
 * @package @eks-food/domain
 *
 * Root barrel for the Eks-Food domain package.
 *
 * Structure:
 *  - The shared kernel is re-exported directly because its types
 *    (UUID, Money, DomainEvent, Result, ...) are universally useful
 *    and do not collide with any context-local type.
 *  - Each bounded context is re-exported as a namespace so callers
 *    must qualify cross-context references (e.g. `booking.BookingAggregate`
 *    vs `payments.PaymentAggregate`). This is intentional: it makes
 *    the bounded-context boundaries visible at every import site and
 *    prevents accidental coupling via name collisions (e.g.
 *    `CuisineCode` is defined in cook, restaurant AND foodgraph).
 *
 * Usage:
 *   import { uuid, ok, err, type Result } from '@eks-food/domain';
 *   import { booking, cook, payments } from '@eks-food/domain';
 *
 *   const id: booking.BookingAggregate['id'] = uuid();
 *   const r: Result<booking.BookingAggregate, DomainError> = ok(...);
 *
 * Constraints:
 *  - Pure TypeScript, no runtime business logic, no Prisma, no Next.js.
 *  - Every context is namespaced; the shared kernel is flat.
 */

// Shared kernel — flat re-export.
export * from './shared';

// Bounded contexts — namespaced re-export.
export * as identity from './contexts/identity';
export * as organization from './contexts/organization';
export * as customer from './contexts/customer';
export * as cook from './contexts/cook';
export * as restaurant from './contexts/restaurant';
export * as vendor from './contexts/vendor';
export * as supplier from './contexts/supplier';
export * as procurement from './contexts/procurement';
export * as marketplace from './contexts/marketplace';
export * as booking from './contexts/booking';
export * as scheduling from './contexts/scheduling';
export * as delivery from './contexts/delivery';
export * as payments from './contexts/payments';
export * as notifications from './contexts/notifications';
export * as inventory from './contexts/inventory';
export * as safety from './contexts/safety';
export * as analytics from './contexts/analytics';
export * as ai from './contexts/ai';
export * as optimization from './contexts/optimization';
export * as foodgraph from './contexts/foodgraph';
export * as developer from './contexts/developer';
