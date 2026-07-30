/** Canonical feature flag keys — the single registry of platform capabilities. */
export const FLAG_KEYS = [
  "ai_assistant",
  "group_purchasing",
  "shared_cooking",
  "restaurant_marketplace",
  "ready_meals",
  "procurement",
  "food_intelligence",
  "rider_platform",
  "vendor_marketplace",
  "food_safety_inspections",
  "developer_platform",
  "multi_country",
] as const;

export type FlagKey = (typeof FLAG_KEYS)[number];

export const FLAG_LABELS: Record<FlagKey, string> = {
  ai_assistant: "AI Assistant",
  group_purchasing: "Group Purchasing",
  shared_cooking: "Shared Cooking Engine",
  restaurant_marketplace: "Restaurant Marketplace",
  ready_meals: "Ready Meals",
  procurement: "Procurement Module",
  food_intelligence: "Food Intelligence",
  rider_platform: "Rider Platform",
  vendor_marketplace: "Vendor Marketplace",
  food_safety_inspections: "Food Safety Inspections",
  developer_platform: "Developer Platform",
  multi_country: "Multi-Country",
};
