/**
 * @file contexts/booking/index.ts
 * @package @eks-food/domain/contexts/booking
 *
 * Booking bounded context barrel.
 *
 * The booking context is the central transactional artefact of Eks-Food.
 * It ties together a customer, a cook, a service and a payment, and
 * orchestrates the matching → reservation → checkout → fulfilment flow.
 */

export * from './events';
export * from './value-objects';
export * from './aggregates';
export * from './repositories';
export * from './services';
