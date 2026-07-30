/** Extensible organization-type registry. The type list is data, not code. */
export type OrganizationTypeCode =
  | "HOUSEHOLD" | "RESTAURANT" | "VENDOR" | "SUPPLIER" | "CATERING"
  | "FRANCHISE" | "INSPECTION_AGENCY" | "LOGISTICS" | "ENTERPRISE";

export const ORGANIZATION_TYPES: ReadonlyArray<{ code: OrganizationTypeCode; name: string; description: string }> = [
  { code: "HOUSEHOLD", name: "Household", description: "A single household booking cooks for home meals." },
  { code: "RESTAURANT", name: "Restaurant", description: "A restaurant operating on the marketplace." },
  { code: "VENDOR", name: "Street Food Vendor", description: "A street-food vendor stall." },
  { code: "SUPPLIER", name: "Supplier", description: "An ingredient / goods supplier." },
  { code: "CATERING", name: "Catering Company", description: "A catering company serving events." },
  { code: "FRANCHISE", name: "Franchise", description: "A multi-location franchise operation." },
  { code: "INSPECTION_AGENCY", name: "Inspection Agency", description: "A food-safety inspection agency." },
  { code: "LOGISTICS", name: "Logistics Company", description: "A delivery / logistics company." },
  { code: "ENTERPRISE", name: "Enterprise", description: "A large enterprise with internal food services." },
];
