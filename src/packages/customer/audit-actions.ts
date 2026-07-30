/**
 * @file customer/audit-actions.ts
 * @package @eks/customer
 *
 * Customer Platform audit action codes.
 *
 * Responsibility:
 *  - Define the canonical set of audit action codes emitted by the
 *    customer context. Every customer-relevant operation (household
 *    lifecycle, member management, address validation, food preference
 *    authoring, dietary profile assignment, allergy recording,
 *    nutrition goal setting, meal history/planning, shopping list
 *    lifecycle, pantry tracking, favorites, reviews & ratings,
 *    notification preferences, household invitations, and the
 *    corresponding deletion operations) is recorded in the immutable
 *    audit log with one of these codes so analysts, SIEM integrations
 *    and compliance reports can pivot on a stable, enumerable
 *    vocabulary.
 *
 * Constraints:
 *  - Codes are uppercase SNAKE_CASE, distinct from the canonical
 *    domain event names (which are `{Aggregate}.{Verb}`) — audit
 *    actions capture the actor-side intent AND the negative outcomes
 *    that never mutate an aggregate (e.g. `PANTRY_ITEM_EXPIRED`,
 *    `REVIEW_MODERATED`, `SHOPPING_LIST_COMPLETED`).
 *  - Codes are stable and append-only; never re-use a retired code.
 *  - No `any`, no runtime side effects — pure constant.
 */

/**
 * Canonical customer audit action codes. Append-only.
 *
 * The single source of truth for what gets written to the audit log's
 * `action` column whenever a customer operation occurs. Downstream
 * consumers (SIEM, compliance reports, anomaly detection, support
 * tooling, recommendation feedback loops) MUST reference these
 * constants rather than spelling out the literal string.
 */
export const CUSTOMER_AUDIT_ACTIONS = {
  // Household lifecycle
  HOUSEHOLD_CREATED: "HOUSEHOLD_CREATED",
  HOUSEHOLD_UPDATED: "HOUSEHOLD_UPDATED",
  HOUSEHOLD_DELETED: "HOUSEHOLD_DELETED",

  // Household members
  HOUSEHOLD_MEMBER_ADDED: "HOUSEHOLD_MEMBER_ADDED",
  HOUSEHOLD_MEMBER_REMOVED: "HOUSEHOLD_MEMBER_REMOVED",
  HOUSEHOLD_RELATIONSHIP_CREATED: "HOUSEHOLD_RELATIONSHIP_CREATED",

  // Address lifecycle
  ADDRESS_ADDED: "ADDRESS_ADDED",
  ADDRESS_VALIDATED: "ADDRESS_VALIDATED",

  // Preferences
  PREFERENCE_UPDATED: "PREFERENCE_UPDATED",
  CUISINE_PREFERENCE_SET: "CUISINE_PREFERENCE_SET",
  INGREDIENT_PREFERENCE_SET: "INGREDIENT_PREFERENCE_SET",

  // Dietary intelligence
  DIETARY_PROFILE_ASSIGNED: "DIETARY_PROFILE_ASSIGNED",
  ALLERGY_RECORDED: "ALLERGY_RECORDED",
  NUTRITION_GOAL_SET: "NUTRITION_GOAL_SET",

  // Meal history & planning
  MEAL_HISTORY_RECORDED: "MEAL_HISTORY_RECORDED",
  MEAL_PLAN_CREATED: "MEAL_PLAN_CREATED",
  MEAL_PLANNED: "MEAL_PLANNED",
  MEAL_PLAN_DELETED: "MEAL_PLAN_DELETED",

  // Shopping list lifecycle
  SHOPPING_LIST_CREATED: "SHOPPING_LIST_CREATED",
  SHOPPING_LIST_ITEM_ADDED: "SHOPPING_LIST_ITEM_ADDED",
  SHOPPING_LIST_COMPLETED: "SHOPPING_LIST_COMPLETED",
  SHOPPING_LIST_DELETED: "SHOPPING_LIST_DELETED",

  // Pantry lifecycle
  PANTRY_UPDATED: "PANTRY_UPDATED",
  PANTRY_ITEM_ADDED: "PANTRY_ITEM_ADDED",
  PANTRY_ITEM_EXPIRED: "PANTRY_ITEM_EXPIRED",
  PANTRY_ITEM_REMOVED: "PANTRY_ITEM_REMOVED",

  // Favorites
  FAVORITE_ADDED: "FAVORITE_ADDED",
  FAVORITE_REMOVED: "FAVORITE_REMOVED",

  // Reviews & ratings
  REVIEW_SUBMITTED: "REVIEW_SUBMITTED",
  REVIEW_MODERATED: "REVIEW_MODERATED",
  REVIEW_DELETED: "REVIEW_DELETED",
  RATING_SUBMITTED: "RATING_SUBMITTED",

  // Notification preferences
  NOTIFICATION_PREFERENCE_UPDATED: "NOTIFICATION_PREFERENCE_UPDATED",

  // Household invitations
  HOUSEHOLD_INVITATION_SENT: "HOUSEHOLD_INVITATION_SENT",
  HOUSEHOLD_INVITATION_ACCEPTED: "HOUSEHOLD_INVITATION_ACCEPTED",
} as const;

/** Union type of every customer audit action code. */
export type CustomerAuditAction =
  (typeof CUSTOMER_AUDIT_ACTIONS)[keyof typeof CUSTOMER_AUDIT_ACTIONS];
