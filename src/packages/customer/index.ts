/**
 * @eks/customer — Customer Platform, Household Management & Food Preference Intelligence.
 *
 * Production customer profiles, households, preferences, pantry, shopping lists,
 * meal planning, favorites, and reviews.
 */

// Domain events + audit actions
export { CUSTOMER_EVENTS, type CustomerEvent, type CustomerEventMeta, buildCustomerEvent } from "./events";
export { CUSTOMER_AUDIT_ACTIONS, type CustomerAuditAction } from "./audit-actions";

// Household management
export { HouseholdService, type HouseholdMemberInput } from "./household";

// Preference engine
export { PreferenceService, type PreferenceUpdate } from "./preference";

// Pantry management
export { PantryService, type PantryItemInput } from "./pantry";

// Shopping lists
export { ShoppingListService, type ShoppingItemInput } from "./shopping";

// Meal planning
export { MealPlanService, type MealSlotInput } from "./meal-plan";

// Favorites
export { FavoriteService } from "./favorite";

// Reviews
export { ReviewService, type ReviewInput } from "./review";
