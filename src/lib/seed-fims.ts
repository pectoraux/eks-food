import { db } from "@/lib/db";
import { MeasurementConverter } from "@eks/fims";

/** Idempotent seed for the Food Intelligence Platform. */
export async function seedFims(force = false) {
  if (force) {
    await db.catalogExport.deleteMany();
    await db.catalogImportRow.deleteMany();
    await db.catalogImport.deleteMany();
    await db.conversionRule.deleteMany();
    await db.measurementUnit.deleteMany();
    await db.wasteRecord.deleteMany();
    await db.inventoryAudit.deleteMany();
    await db.inventoryReservation.deleteMany();
    await db.inventoryMovement.deleteMany();
    await db.inventoryLocation.deleteMany();
    await db.menuBundle.deleteMany();
    await db.menuModifier.deleteMany();
    await db.menuVersion.deleteMany();
    await db.dietaryProfile.deleteMany();
    await db.allergen.deleteMany();
    await db.nutritionFact.deleteMany();
    await db.recipeInstruction.deleteMany();
    await db.recipeStage.deleteMany();
    await db.recipeVersion.deleteMany();
    await db.ingredientAlias.deleteMany();
    await db.ingredientVariant.deleteMany();
    await db.foodCategory.deleteMany();
    await db.foodCatalog.deleteMany();
  }

  const org = await db.organization.findFirst();
  if (!org) return { error: "no_org" };

  // 1. Measurement units.
  const units = [
    { code: "g", name: "Gram", type: "WEIGHT", baseUnit: "g", baseFactor: 1 },
    { code: "kg", name: "Kilogram", type: "WEIGHT", baseUnit: "g", baseFactor: 1000 },
    { code: "oz", name: "Ounce", type: "WEIGHT", baseUnit: "g", baseFactor: 28.3495 },
    { code: "lb", name: "Pound", type: "WEIGHT", baseUnit: "g", baseFactor: 453.592 },
    { code: "ml", name: "Milliliter", type: "VOLUME", baseUnit: "ml", baseFactor: 1 },
    { code: "L", name: "Liter", type: "VOLUME", baseUnit: "ml", baseFactor: 1000 },
    { code: "cup", name: "Cup", type: "VOLUME", baseUnit: "ml", baseFactor: 240 },
    { code: "tbsp", name: "Tablespoon", type: "VOLUME", baseUnit: "ml", baseFactor: 15 },
    { code: "tsp", name: "Teaspoon", type: "VOLUME", baseUnit: "ml", baseFactor: 5 },
    { code: "piece", name: "Piece", type: "COUNT", baseUnit: "piece", baseFactor: 1 },
  ];
  for (const u of units) {
    const existing = await db.measurementUnit.findUnique({ where: { code: u.code } });
    if (!existing) await db.measurementUnit.create({ data: { ...u, nameLocalized: JSON.stringify({ en: u.name }) } });
  }

  // 2. Conversion rules (density-aware).
  const conversions = [
    { fromUnit: "cup", toUnit: "g", factor: 240, densityAware: true, ingredientCode: "water", density: 1.0 },
    { fromUnit: "cup", toUnit: "g", factor: 220, densityAware: true, ingredientCode: "oil", density: 0.92 },
    { fromUnit: "cup", toUnit: "g", factor: 125, densityAware: true, ingredientCode: "flour", density: 0.52 },
  ];
  for (const c of conversions) {
    const existing = await db.conversionRule.findUnique({ where: { fromUnit_toUnit_ingredientCode: { fromUnit: c.fromUnit, toUnit: c.toUnit, ingredientCode: c.ingredientCode } } });
    if (!existing) await db.conversionRule.create({ data: c });
  }

  // 3. Food categories (taxonomy).
  const categories = [
    { code: "GRAINS", name: "Grains", type: "CATEGORY", sortOrder: 1 },
    { code: "VEGETABLES", name: "Vegetables", type: "CATEGORY", sortOrder: 2 },
    { code: "PROTEINS", name: "Proteins", type: "CATEGORY", sortOrder: 3 },
    { code: "FATS_OILS", name: "Fats & Oils", type: "CATEGORY", sortOrder: 4 },
    { code: "SPICES", name: "Spices", type: "CATEGORY", sortOrder: 5 },
    { code: "GHANAIAN", name: "Ghanaian", type: "CUISINE", sortOrder: 1 },
    { code: "NIGERIAN", name: "Nigerian", type: "CUISINE", sortOrder: 2 },
    { code: "VEGAN", name: "Vegan", type: "DIETARY", sortOrder: 1 },
    { code: "GLUTEN_FREE", name: "Gluten-Free", type: "DIETARY", sortOrder: 2 },
  ];
  for (const c of categories) {
    const existing = await db.foodCategory.findUnique({ where: { code: c.code } });
    if (!existing) await db.foodCategory.create({ data: { ...c, nameLocalized: JSON.stringify({ en: c.name }) } });
  }

  // 4. Allergens.
  const allergens = [
    { code: "GLUTEN", name: "Gluten", severity: "HIGH" },
    { code: "DAIRY", name: "Dairy", severity: "HIGH" },
    { code: "PEANUTS", name: "Peanuts", severity: "CRITICAL" },
    { code: "EGGS", name: "Eggs", severity: "HIGH" },
    { code: "SOY", name: "Soy", severity: "MEDIUM" },
    { code: "FISH", name: "Fish", severity: "HIGH" },
    { code: "SHELLFISH", name: "Shellfish", severity: "CRITICAL" },
    { code: "TREE_NUTS", name: "Tree Nuts", severity: "CRITICAL" },
  ];
  for (const a of allergens) {
    const existing = await db.allergen.findUnique({ where: { code: a.code } });
    if (!existing) await db.allergen.create({ data: { ...a, nameLocalized: JSON.stringify({ en: a.name }) } });
  }

  // 5. Dietary profiles.
  const diets = [
    { code: "VEGAN", name: "Vegan", forbiddenAllergens: ["DAIRY","EGGS","HONEY"], forbiddenCategories: ["meat","fish","poultry"] },
    { code: "VEGETARIAN", name: "Vegetarian", forbiddenCategories: ["meat","fish","poultry"] },
    { code: "GLUTEN_FREE", name: "Gluten-Free", forbiddenAllergens: ["GLUTEN","WHEAT"] },
    { code: "DAIRY_FREE", name: "Dairy-Free", forbiddenAllergens: ["DAIRY","MILK"] },
    { code: "KETO", name: "Keto", forbiddenCategories: ["grain","sugar","starch"] },
    { code: "PALEO", name: "Paleo", forbiddenAllergens: ["DAIRY"], forbiddenCategories: ["grain","legume","sugar"] },
    { code: "HALAL", name: "Halal", forbiddenCategories: ["pork","alcohol"] },
    { code: "KOSHER", name: "Kosher", forbiddenCategories: ["pork","shellfish"] },
    { code: "LOW_SODIUM", name: "Low Sodium" },
    { code: "DIABETIC_FRIENDLY", name: "Diabetic Friendly" },
  ];
  for (const d of diets) {
    const existing = await db.dietaryProfile.findUnique({ where: { code: d.code } });
    if (!existing) await db.dietaryProfile.create({ data: { code: d.code, name: d.name, nameLocalized: JSON.stringify({ en: d.name }), forbiddenAllergens: JSON.stringify(d.forbiddenAllergens ?? []), forbiddenCategories: JSON.stringify(d.forbiddenCategories ?? []), isSystem: true } });
  }

  // 6. Food catalog items.
  const catalogItems = [
    { code: "FC-RICE-001", name: "Long Grain Rice", itemType: "INGREDIENT", barcode: "6012345678901", sku: "RICE-25KG", categories: ["GRAINS"], nutrition: { calories: 365, protein: 7, carbohydrates: 80, fat: 0.6, fiber: 1.3, sugar: 0.1, sodium: 5 }, allergens: [], dietaryTags: ["VEGAN","GLUTEN_FREE"] },
    { code: "FC-TOM-001", name: "Fresh Tomatoes", itemType: "INGREDIENT", barcode: "6012345678902", sku: "TOM-10KG", categories: ["VEGETABLES"], nutrition: { calories: 18, protein: 0.9, carbohydrates: 3.9, fat: 0.2, fiber: 1.2, sugar: 2.6, sodium: 5 }, allergens: [], dietaryTags: ["VEGAN","VEGETARIAN","GLUTEN_FREE","KETO","PALEO"] },
    { code: "FC-OIL-001", name: "Vegetable Oil", itemType: "INGREDIENT", barcode: "6012345678903", sku: "OIL-20L", categories: ["FATS_OILS"], nutrition: { calories: 884, protein: 0, carbohydrates: 0, fat: 100, fiber: 0, sugar: 0, sodium: 0 }, allergens: [], dietaryTags: ["VEGAN","GLUTEN_FREE","KETO","PALEO"] },
    { code: "FC-ONION-001", name: "Onions", itemType: "INGREDIENT", barcode: "6012345678904", sku: "ONI-10KG", categories: ["VEGETABLES"], nutrition: { calories: 40, protein: 1.1, carbohydrates: 9.3, fat: 0.1, fiber: 1.7, sugar: 4.2, sodium: 4 }, allergens: [], dietaryTags: ["VEGAN","VEGETARIAN","GLUTEN_FREE","KETO","PALEO"] },
    { code: "FC-PEPPER-001", name: "Scotch Bonnet Pepper", itemType: "SPICE", barcode: "6012345678905", sku: "PEP-5KG", categories: ["SPICES","VEGETABLES"], nutrition: { calories: 40, protein: 1.9, carbohydrates: 9.5, fat: 0.4, fiber: 1.5, sugar: 5.3, sodium: 9 }, allergens: [], dietaryTags: ["VEGAN","VEGETARIAN","GLUTEN_FREE","KETO","PALEO"] },
    { code: "FC-CHICKEN-001", name: "Chicken Thighs", itemType: "INGREDIENT", barcode: "6012345678906", sku: "CHK-10KG", categories: ["PROTEINS"], nutrition: { calories: 209, protein: 26, carbohydrates: 0, fat: 11, fiber: 0, sugar: 0, sodium: 89 }, allergens: [], dietaryTags: ["GLUTEN_FREE","KETO","PALEO","HALAL","KOSHER"] },
  ];
  for (const item of catalogItems) {
    const existing = await db.foodCatalog.findUnique({ where: { code: item.code } });
    if (!existing) {
      const catalog = await db.foodCatalog.create({
        data: { code: item.code, name: item.name, organizationId: org.id, itemType: item.itemType, barcode: item.barcode, sku: item.sku, categories: JSON.stringify(item.categories), status: "ACTIVE", aliases: JSON.stringify([]), images: JSON.stringify([]), nameLocalized: JSON.stringify({ en: item.name }), metadata: JSON.stringify({}) },
      });
      await db.nutritionFact.create({
        data: { entityType: "CATALOG_ITEM", entityId: catalog.id, catalogId: catalog.id, perAmount: 100, perUnit: "g", calories: item.nutrition.calories, protein: item.nutrition.protein, carbohydrates: item.nutrition.carbohydrates, fat: item.nutrition.fat, fiber: item.nutrition.fiber, sugar: item.nutrition.sugar, sodium: item.nutrition.sodium, allergens: JSON.stringify(item.allergens), dietaryTags: JSON.stringify(item.dietaryTags), source: "MANUAL" },
      });
    }
  }

  // 7. Ingredient aliases.
  const aliases = [
    { name: "Emuo", canonicalName: "Rice", language: "tw" },
    { name: "Tomatini", canonicalName: "Tomatoes", language: "tw" },
    { name: "Sikà", canonicalName: "Oil", language: "tw" },
    { name: "Gyene", canonicalName: "Onions", language: "tw" },
  ];
  for (const a of aliases) {
    const existing = await db.ingredientAlias.findUnique({ where: { name_language: { name: a.name, language: a.language } } });
    if (!existing) await db.ingredientAlias.create({ data: a });
  }

  // 8. Recipe version (for M6 Recipe).
  const recipe = await db.recipe.findFirst();
  if (recipe) {
    const existingVersion = await db.recipeVersion.findFirst({ where: { recipeId: recipe.id, version: 1 } });
    if (!existingVersion) {
      const version = await db.recipeVersion.create({
        data: { recipeId: recipe.id, version: 1, snapshot: JSON.stringify({ name: recipe.name, steps: recipe.steps }), status: "PUBLISHED", publishedAt: new Date() },
      });
      // Recipe stages.
      const stage1 = await db.recipeStage.create({ data: { versionId: version.id, name: "Preparation", type: "PREP", sortOrder: 1, estimatedMin: 20 } });
      const stage2 = await db.recipeStage.create({ data: { versionId: version.id, name: "Cooking", type: "COOK", sortOrder: 2, estimatedMin: 40 } });
      await db.recipeInstruction.create({ data: { stageId: stage1.id, sortOrder: 1, instruction: "Wash and soak rice", estimatedMin: 5 } });
      await db.recipeInstruction.create({ data: { stageId: stage1.id, sortOrder: 2, instruction: "Blend tomatoes, onions, and peppers", estimatedMin: 10 } });
      await db.recipeInstruction.create({ data: { stageId: stage2.id, sortOrder: 1, instruction: "Heat oil and fry onion until translucent", estimatedMin: 5 } });
      await db.recipeInstruction.create({ data: { stageId: stage2.id, sortOrder: 2, instruction: "Add tomato blend and simmer for 15 minutes", estimatedMin: 15 } });
      await db.recipeInstruction.create({ data: { stageId: stage2.id, sortOrder: 3, instruction: "Add rice and stock, cover and cook until done", estimatedMin: 20 } });
    }
  }

  // 9. Inventory location.
  const existingLoc = await db.inventoryLocation.count({ where: { organizationId: org.id } });
  if (existingLoc === 0) {
    await db.inventoryLocation.create({ data: { organizationId: org.id, name: "East Legon Dry Storage", type: "DRY_STORAGE", capacity: JSON.stringify({ area: 50, shelves: 12 }) } });
    await db.inventoryLocation.create({ data: { organizationId: org.id, name: "East Legon Refrigerator", type: "REFRIGERATOR", minTempC: 2, maxTempC: 8, capacity: JSON.stringify({ volume: 500 }) } });
  }

  // 10. Inventory movement (sample).
  const inventory = await db.inventory.findFirst();
  if (inventory) {
    const existingMov = await db.inventoryMovement.count({ where: { inventoryId: inventory.id } });
    if (existingMov === 0) {
      const loc = await db.inventoryLocation.findFirst({ where: { organizationId: org.id } });
      await db.inventoryMovement.create({
        data: { inventoryId: inventory.id, locationId: loc?.id, type: "RECEIVE", quantity: 5000, unit: "g", metadata: JSON.stringify({ reason: "Initial stock", supplier: "Accra Wholesale" }) },
      });
      await db.inventoryMovement.create({
        data: { inventoryId: inventory.id, locationId: loc?.id, type: "CONSUME", quantity: 500, unit: "g", metadata: JSON.stringify({ reason: "Jollof preparation" }) },
      });
    }
  }

  // 11. Waste record (sample).
  const existingWaste = await db.wasteRecord.count({ where: { organizationId: org.id } });
  if (existingWaste === 0 && inventory) {
    await db.wasteRecord.create({ data: { organizationId: org.id, inventoryId: inventory.id, type: "SPOILAGE", quantity: 200, unit: "g", reason: "Improper storage temperature", recordedById: "system" } });
  }

  return {
    catalogItems: await db.foodCatalog.count(),
    categories: await db.foodCategory.count(),
    allergens: await db.allergen.count(),
    dietaryProfiles: await db.dietaryProfile.count(),
    measurementUnits: await db.measurementUnit.count(),
    conversionRules: await db.conversionRule.count(),
    nutritionFacts: await db.nutritionFact.count(),
    recipeVersions: await db.recipeVersion.count(),
    recipeStages: await db.recipeStage.count(),
    recipeInstructions: await db.recipeInstruction.count(),
    ingredientAliases: await db.ingredientAlias.count(),
    inventoryLocations: await db.inventoryLocation.count(),
    inventoryMovements: await db.inventoryMovement.count(),
    wasteRecords: await db.wasteRecord.count(),
  };
}
