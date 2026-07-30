import { db } from "@/lib/db";

/** Idempotent seed for the canonical food domain + Food Intelligence Graph. */
export async function seedFoodDomain(force = false) {
  if (force) {
    await db.relationship.deleteMany();
    await db.entityVersion.deleteMany();
    await db.graphEdge.deleteMany();
    await db.graphNode.deleteMany();
    await db.nutritionProfile.deleteMany();
    await db.foodSafetyIncident.deleteMany();
    await db.foodInspection.deleteMany();
    await db.foodCertification.deleteMany();
    await db.vendor.deleteMany();
    await db.supplier.deleteMany();
    await db.vehicle.deleteMany();
    await db.equipment.deleteMany();
    await db.inventoryBatch.deleteMany();
    await db.inventory.deleteMany();
    await db.menuItem.deleteMany();
    await db.menu.deleteMany();
    await db.recipeIngredient.deleteMany();
    await db.recipe.deleteMany();
    await db.ingredient.deleteMany();
    await db.kitchen.deleteMany();
    await db.restaurant.deleteMany();
    await db.cookProfile.deleteMany();
    await db.customerProfile.deleteMany();
    await db.household.deleteMany();
    await db.neighborhood.deleteMany();
    await db.city.deleteMany();
    await db.geoRegion.deleteMany();
    await db.country.deleteMany();
  }

  const org = await db.organization.findFirst();
  if (!org) return { error: "no_org" };

  // 1. Geographic hierarchy.
  const ghana = await db.country.upsert({ where: { code: "GH" }, update: {}, create: { code: "GH", name: "Ghana", nameLocalized: JSON.stringify({ en: "Ghana", tw: "Ghana" }), currency: "GHS" } });
  const accraRegion = await db.geoRegion.create({ data: { countryId: ghana.id, code: "greater-accra", name: "Greater Accra", type: "REGION" } });
  const accraCity = await db.city.create({ data: { countryId: ghana.id, regionId: accraRegion.id, code: "accra", name: "Accra", lat: 5.6037, lng: -0.1870 } });
  await db.neighborhood.create({ data: { cityId: accraCity.id, countryId: ghana.id, name: "East Legon", deliveryZoneCode: "EL-01", lat: 5.645, lng: -0.181 } });
  await db.neighborhood.create({ data: { cityId: accraCity.id, countryId: ghana.id, name: "Osu", deliveryZoneCode: "OS-01", lat: 5.558, lng: -0.183 } });
  await db.neighborhood.create({ data: { cityId: accraCity.id, countryId: ghana.id, name: "Cantonments", deliveryZoneCode: "CT-01", lat: 5.580, lng: -0.183 } });

  // 2. Household + Customer.
  const household = await db.household.create({ data: { organizationId: org.id, name: "Boateng Household", address: JSON.stringify({ line1: "12 Liberation Road", neighborhood: "East Legon", city: "Accra" }) } });
  await db.customerProfile.create({ data: { organizationId: org.id, householdId: household.id, name: "Abena Boateng", email: "abena@household.com", phone: "+233245550101", dietaryPrefs: JSON.stringify(["low_sodium"]), allergies: JSON.stringify(["peanuts"]), favoriteCuisines: JSON.stringify(["ghanaian", "vegan"]), nutritionGoals: JSON.stringify({ calories: 2000, protein: 80 }) } });
  await db.customerProfile.create({ data: { organizationId: org.id, householdId: household.id, name: "Kofi Boateng", email: "kofi@household.com", dietaryPrefs: JSON.stringify([]), allergies: JSON.stringify(["shellfish"]) } });

  // 3. Cook.
  await db.cookProfile.create({ data: { organizationId: org.id, name: "Amara Mensah", bio: "Home-style Ghanaian cooking", cuisines: JSON.stringify(["ghanaian", "nigerian"]), languages: JSON.stringify(["en", "tw"]), serviceAreas: JSON.stringify(["East Legon", "Osu"]), workingHours: JSON.stringify({ "1": ["8-20"], "2": ["8-20"], "3": ["8-20"] }), status: "ACTIVE", rating: 4.9 } });

  // 4. Restaurant + Menu + Menu Items.
  const restaurant = await db.restaurant.create({ data: { organizationId: org.id, name: "Buka Accra", description: "Authentic Ghanaian cuisine", cuisines: JSON.stringify(["ghanaian"]), operatingHours: JSON.stringify({ open: "10:00", close: "22:00" }), status: "ACTIVE" } });
  const menu = await db.menu.create({ data: { restaurantId: restaurant.id, name: "Main Menu", status: "ACTIVE" } });

  // 5. Ingredients.
  const rice = await db.ingredient.create({ data: { code: "ING-RICE-001", name: "Long Grain Rice", nameLocalized: JSON.stringify({ en: "Rice", tw: "Emuo" }), categories: JSON.stringify(["grain", "staple"]), units: JSON.stringify(["kg", "g", "bag"]), nutrition: JSON.stringify({ calories: 365, protein: 7, carbs: 80, fat: 0.6 }), allergens: JSON.stringify([]), shelfLifeDays: 365, storageRequirements: JSON.stringify({ temp: "cool", humidity: "dry" }) } });
  const tomato = await db.ingredient.create({ data: { code: "ING-TOM-001", name: "Fresh Tomatoes", nameLocalized: JSON.stringify({ en: "Tomato", tw: "Tomatini" }), categories: JSON.stringify(["vegetable"]), units: JSON.stringify(["kg", "g"]), nutrition: JSON.stringify({ calories: 18, protein: 0.9, carbs: 3.9 }), allergens: JSON.stringify([]), shelfLifeDays: 14 } });
  const oil = await db.ingredient.create({ data: { code: "ING-OIL-001", name: "Vegetable Oil", categories: JSON.stringify(["fat", "cooking_oil"]), units: JSON.stringify(["L", "ml"]), nutrition: JSON.stringify({ calories: 884, fat: 100 }), shelfLifeDays: 730 } });

  // 6. Recipe + RecipeIngredients.
  const recipe = await db.recipe.create({ data: { organizationId: org.id, name: "Jollof Rice", nameLocalized: JSON.stringify({ en: "Jollof Rice", tw: "Jollof Emuo" }), description: "Classic West African jollof rice", steps: JSON.stringify(["Wash rice", "Blend tomatoes", "Fry onion in oil", "Add tomato blend", "Add rice and stock", "Simmer until cooked"]), nutrition: JSON.stringify({ calories: 420, protein: 8, carbs: 75, fat: 12 }), prepTimeMin: 20, cookTimeMin: 40, servingSize: 4, status: "PUBLISHED" } });
  await db.recipeIngredient.create({ data: { recipeId: recipe.id, ingredientId: rice.id, quantity: 500, unit: "g", preparation: "washed" } });
  await db.recipeIngredient.create({ data: { recipeId: recipe.id, ingredientId: tomato.id, quantity: 400, unit: "g", preparation: "blended" } });
  await db.recipeIngredient.create({ data: { recipeId: recipe.id, ingredientId: oil.id, quantity: 50, unit: "ml" } });

  // 7. Menu Item.
  await db.menuItem.create({ data: { menuId: menu.id, recipeId: recipe.id, name: "Jollof Rice", description: "Classic Ghanaian jollof", priceReference: 25, currency: "GHS", prepEstimateMin: 60, dietaryLabels: JSON.stringify(["gluten-free"]) } });

  // 8. Kitchen.
  await db.kitchen.create({ data: { organizationId: org.id, name: "East Legon Cloud Kitchen", type: "CLOUD", capacity: JSON.stringify({ stations: 4, maxCooks: 6, mealsPerHour: 30 }), status: "ACTIVE", location: JSON.stringify({ neighborhood: "East Legon", lat: 5.645, lng: -0.181 }) } });

  // 9. Inventory + Batch.
  const inventory = await db.inventory.create({ data: { organizationId: org.id, ingredientId: rice.id, name: "Rice Stock", quantity: 5000, unit: "g", reorderLevel: 1000 } });
  await db.inventoryBatch.create({ data: { inventoryId: inventory.id, batchNumber: "BATCH-001", initialQuantity: 5000, remainingQuantity: 4500, unit: "g", expiresAt: new Date(Date.now() + 365 * 86400000), status: "IN_USE" } });

  // 10. Equipment + Vehicle.
  await db.equipment.create({ data: { organizationId: org.id, name: "Industrial Stove", capacity: JSON.stringify({ burners: 6 }), status: "ACTIVE" } });
  await db.vehicle.create({ data: { organizationId: org.id, name: "Delivery Van 1", type: "REFRIGERATED", refrigerated: true, cargoCapacityKg: 500, status: "ACTIVE" } });

  // 11. Supplier + Vendor.
  await db.supplier.create({ data: { organizationId: org.id, name: "Accra Wholesale Foods", productCatalog: JSON.stringify(["ING-RICE-001", "ING-TOM-001", "ING-OIL-001"]), certifications: JSON.stringify(["HACCP"]), operatingRegions: JSON.stringify(["Greater Accra"]), leadTimeDays: 3, status: "ACTIVE" } });
  await db.vendor.create({ data: { organizationId: org.id, name: "Makola Market Vendor", type: "MARKETPLACE", products: JSON.stringify(["ING-TOM-001"]), status: "ACTIVE" } });

  // 12. Certification.
  await db.foodCertification.create({ data: { organizationId: org.id, title: "Food Safety Level 2", issuer: "Ghana FDA", type: "FOOD_SAFETY", entityType: "COOK", entityId: (await db.cookProfile.findFirst())!.id, status: "VERIFIED", issuedAt: new Date(Date.now() - 200 * 86400000), expiresAt: new Date(Date.now() + 165 * 86400000) } });

  // 13. Inspection.
  await db.foodInspection.create({ data: { organizationId: org.id, entityType: "KITCHEN", entityId: (await db.kitchen.findFirst())!.id, status: "COMPLETED", findings: JSON.stringify([{ item: "Hand washing station", passed: true }]), violations: JSON.stringify([]), correctiveActions: JSON.stringify([]), outcome: "PASS", scheduledFor: new Date(Date.now() - 7 * 86400000), completedAt: new Date(Date.now() - 6 * 86400000) } });

  // 14. Food Safety Incident.
  await db.foodSafetyIncident.create({ data: { organizationId: org.id, title: "Minor contamination report", type: "COMPLAINT", severity: "LOW", status: "RESOLVED", resolvedAt: new Date(), correctiveActions: JSON.stringify(["Sanitized surface", "Retrained staff"]) } });

  // 15. Nutrition Profile.
  await db.nutritionProfile.create({ data: { organizationId: org.id, name: "Standard Adult", macros: JSON.stringify({ calories: 2000, protein: 50, carbs: 275, fat: 70, fiber: 28 }), micros: JSON.stringify({ iron: "18mg", calcium: "1000mg" }), dietaryRestrictions: JSON.stringify([]), labels: JSON.stringify(["balanced"]) } });

  // 16. Food Intelligence Graph — create nodes + edges.
  const graphEngine = new (await import("@eks/food-domain")).GraphEngine();
  // Nodes are auto-created via ensureNode when creating edges.
  await graphEngine.createEdge("CUSTOMER", (await db.customerProfile.findFirst())!.id, "HOUSEHOLD", household.id, "member_of");
  await graphEngine.createEdge("COOK", (await db.cookProfile.findFirst())!.id, "KITCHEN", (await db.kitchen.findFirst())!.id, "works_at");
  await graphEngine.createEdge("RECIPE", recipe.id, "INGREDIENT", rice.id, "contains", { quantity: 500, unit: "g" });
  await graphEngine.createEdge("RECIPE", recipe.id, "INGREDIENT", tomato.id, "contains", { quantity: 400, unit: "g" });
  await graphEngine.createEdge("RECIPE", recipe.id, "INGREDIENT", oil.id, "contains", { quantity: 50, unit: "ml" });
  await graphEngine.createEdge("RESTAURANT", restaurant.id, "KITCHEN", (await db.kitchen.findFirst())!.id, "operates");
  await graphEngine.createEdge("SUPPLIER", (await db.supplier.findFirst())!.id, "INGREDIENT", rice.id, "supplies");
  await graphEngine.createEdge("MENU", menu.id, "MENU_ITEM", (await db.menuItem.findFirst())!.id, "contains");
  await graphEngine.createEdge("FOOD_CERTIFICATION", (await db.foodCertification.findFirst())!.id, "COOK", (await db.cookProfile.findFirst())!.id, "certified_by");
  await graphEngine.createEdge("FOOD_INSPECTION", (await db.foodInspection.findFirst())!.id, "KITCHEN", (await db.kitchen.findFirst())!.id, "inspects");

  return {
    countries: await db.country.count(),
    regions: await db.geoRegion.count(),
    cities: await db.city.count(),
    neighborhoods: await db.neighborhood.count(),
    households: await db.household.count(),
    customers: await db.customerProfile.count(),
    cooks: await db.cookProfile.count(),
    restaurants: await db.restaurant.count(),
    kitchens: await db.kitchen.count(),
    ingredients: await db.ingredient.count(),
    recipes: await db.recipe.count(),
    menus: await db.menu.count(),
    inventory: await db.inventory.count(),
    equipment: await db.equipment.count(),
    vehicles: await db.vehicle.count(),
    suppliers: await db.supplier.count(),
    vendors: await db.vendor.count(),
    certifications: await db.foodCertification.count(),
    inspections: await db.foodInspection.count(),
    incidents: await db.foodSafetyIncident.count(),
    nutrition: await db.nutritionProfile.count(),
    graphNodes: await db.graphNode.count(),
    graphEdges: await db.graphEdge.count(),
    relationships: await db.relationship.count(),
  };
}
