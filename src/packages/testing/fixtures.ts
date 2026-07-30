import type { DomainError, UUID } from "./types";
import { asUUID } from "./types";

/**
 * Fixed, deterministic identifiers shared across tests. Using constants
 * instead of freshly-generated UUIDs makes assertion failures and DB traces
 * easy to grep for.
 */
export const TEST_ORG_ID: UUID = asUUID(
  "00000000-0000-4000-8000-000000000001",
);
export const TEST_USER_ID: UUID = asUUID(
  "00000000-0000-4000-8000-000000000002",
);
export const TEST_COOK_ID: UUID = asUUID(
  "00000000-0000-4000-8000-000000000003",
);
export const TEST_CUSTOMER_ID: UUID = asUUID(
  "00000000-0000-4000-8000-000000000004",
);
export const TEST_BOOKING_ID: UUID = asUUID(
  "00000000-0000-4000-8000-000000000005",
);
export const TEST_PAYMENT_ID: UUID = asUUID(
  "00000000-0000-4000-8000-000000000006",
);

/** A typical Eks-Food organisation record. */
export const TEST_ORG = {
  id: TEST_ORG_ID,
  name: "Eks-Food Accra",
  slug: "eks-food-accra",
  region: "Greater Accra",
  currency: "GHS",
  createdAt: "2024-01-01T00:00:00.000Z",
} as const;

/** A typical manager principal (matches the seeded `manager` demo user). */
export const TEST_MANAGER = {
  id: TEST_USER_ID,
  orgId: TEST_ORG_ID,
  role: "MANAGER" as const,
  email: "manager@eks-food.example",
  displayName: "Amma Manager",
} as const;

/** A typical cook record. */
export const TEST_COOK = {
  id: TEST_COOK_ID,
  orgId: TEST_ORG_ID,
  displayName: "Amara",
  cuisines: ["ghanaian", "nigerian"],
  rating: 4.8,
  hourlyRate: { amount: 2500, currency: "GHS" },
  geoPoint: { lat: 5.6037, lng: -0.187 },
  certifications: [{ code: "food_safety_level_1", verified: true }],
} as const;

/**
 * Sample domain event payloads. Kept structurally compatible with the
 * DomainEvent shape the `@eks/domain` package is expected to emit.
 */
export interface BookingCreatedEvent {
  readonly type: "BookingCreated";
  readonly aggregateId: UUID;
  readonly occurredAt: string;
  readonly payload: {
    readonly bookingCode: string;
    readonly cookId: UUID;
    readonly customerId: UUID;
    readonly scheduledAt: string;
    readonly price: { readonly amount: number; readonly currency: string };
  };
}

export const BOOKING_CREATED_EVENT: BookingCreatedEvent = Object.freeze({
  type: "BookingCreated",
  aggregateId: TEST_BOOKING_ID,
  occurredAt: "2024-01-15T10:30:00.000Z",
  payload: {
    bookingCode: "EKS-TEST01",
    cookId: TEST_COOK_ID,
    customerId: TEST_CUSTOMER_ID,
    scheduledAt: "2024-01-20T18:00:00.000Z",
    price: { amount: 2500, currency: "GHS" },
  },
});

export interface PaymentSucceededEvent {
  readonly type: "PaymentSucceeded";
  readonly aggregateId: UUID;
  readonly occurredAt: string;
  readonly payload: {
    readonly paymentId: UUID;
    readonly bookingId: UUID;
    readonly amount: number;
    readonly currency: string;
    readonly provider: "payswap";
  };
}

export const PAYMENT_SUCCEEDED_EVENT: PaymentSucceededEvent = Object.freeze({
  type: "PaymentSucceeded",
  aggregateId: TEST_PAYMENT_ID,
  occurredAt: "2024-01-15T10:31:00.000Z",
  payload: {
    paymentId: TEST_PAYMENT_ID,
    bookingId: TEST_BOOKING_ID,
    amount: 2500,
    currency: "GHS",
    provider: "payswap" as const,
  },
});

/** A canonical sample DomainError used across assertion tests. */
export const SAMPLE_DOMAIN_ERROR: DomainError = Object.freeze({
  code: "BOOKING_NOT_FOUND",
  message: "No booking exists with that code.",
  details: { bookingCode: "EKS-NOPE" },
});

/**
 * Builders for inbound HTTP requests used by route-handler integration
 * tests. These mirror the headers the Eks-Food RBAC layer expects
 * (`x-eks-org`, `x-eks-user`, `x-eks-role`).
 */
export function makeApiHeaders(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-eks-org": TEST_ORG_ID,
    "x-eks-user": TEST_USER_ID,
    "x-eks-role": "MANAGER",
    ...overrides,
  };
}

/** Sample JSON response bodies, useful as expected values in tests. */
export const SAMPLE_BOOKING_RESPONSE = Object.freeze({
  code: "EKS-TEST01",
  status: "CONFIRMED",
  cookId: TEST_COOK_ID,
  customerId: TEST_CUSTOMER_ID,
  price: { amount: 2500, currency: "GHS" },
  scheduledAt: "2024-01-20T18:00:00.000Z",
});

export const SAMPLE_ERROR_RESPONSE = Object.freeze({
  error: {
    code: "BOOKING_NOT_FOUND",
    message: "No booking exists with that code.",
  },
});
