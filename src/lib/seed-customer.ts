import { db } from "@/lib/db";

/** Idempotent seed for the Customer Platform. */
export async function seedCustomer(force = false) {
  if (force) {
    await db.customerNotificationPreference.deleteMany();
    await db.rating.deleteMany();
    await db.review.deleteMany();
    await db.customerFavorite.deleteMany();
    await db.pantryItem.deleteMany();
    await db.pantry.deleteMany();
    await db.shoppingListItem.deleteMany();
    await db.shoppingList.deleteMany();
    await db.mealCalendar.deleteMany();
    await db.mealPlan.deleteMany();
    await db.mealHistory.deleteMany();
    await db.deliveryInstruction.deleteMany();
    await db.customerAddress.deleteMany();
    await db.nutritionGoal.deleteMany();
    await db.allergyRecord.deleteMany();
    await db.dietaryProfileAssignment.deleteMany();
    await db.ingredientPreference.deleteMany();
    await db.cuisinePreference.deleteMany();
    await db.customerPreference.deleteMany();
    await db.householdRelationship.deleteMany();
    await db.householdMember.deleteMany();
  }

  const org = await db.organization.findFirst();
  if (!org) return { error: "no_org" };

  // Find or create a household.
  let household = await db.household.findFirst({ where: { organizationId: org.id } });
  if (!household) {
    household = await db.household.create({ data: { organizationId: org.id, name: "Demo Household", address: JSON.stringify({ line1: "12 Liberation Road", city: "Accra" }) } });
  }

  // Find or create customer profiles.
  let abena = await db.customerProfile.findFirst({ where: { organizationId: org.id, name: "Abena Boateng" } });
  if (!abena) {
    abena = await db.customerProfile.create({ data: { organizationId: org.id, householdId: household.id, name: "Abena Boateng", email: "abena@household.com", phone: "+233245550101", dietaryPrefs: JSON.stringify(["low_sodium"]), allergies: JSON.stringify(["peanuts"]), favoriteCuisines: JSON.stringify(["ghanaian", "vegan"]), nutritionGoals: JSON.stringify({ calories: 2000, protein: 80 }) } });
  }
  let kofi = await db.customerProfile.findFirst({ where: { organizationId: org.id, name: "Kofi Boateng" } });
  if (!kofi) {
    kofi = await db.customerProfile.create({ data: { organizationId: org.id, householdId: household.id, name: "Kofi Boateng", email: "kofi@household.com", dietaryPrefs: JSON.stringify([]), allergies: JSON.stringify(["shellfish"]) } });
  }

  // Household members.
  const existingMembers = await db.householdMember.count({ where: { householdId: household.id } });
  if (existingMembers === 0) {
    await db.householdMember.create({ data: { householdId: household.id, customerProfileId: abena.id, role: "ADMIN", ageGroup: "ADULT", canManageHousehold: true } });
    await db.householdMember.create({ data: { householdId: household.id, customerProfileId: kofi.id, role: "MEMBER", ageGroup: "ADULT" } });
  }

  // Preferences.
  const existingPrefs = await db.customerPreference.count({ where: { customerProfileId: abena.id } });
  if (existingPrefs === 0) {
    await db.customerPreference.create({ data: { customerProfileId: abena.id, spiceLevel: 7, cookingStyles: JSON.stringify(["stewing", "grilling"]), mealSizes: JSON.stringify(["medium"]), languages: JSON.stringify(["en", "tw"]) } });
  }

  // Cuisine preferences.
  const existingCuisine = await db.cuisinePreference.count({ where: { customerProfileId: abena.id } });
  if (existingCuisine === 0) {
    await db.cuisinePreference.create({ data: { customerProfileId: abena.id, cuisine: "ghanaian", sentiment: "LIKE", score: 95, source: "EXPLICIT" } });
    await db.cuisinePreference.create({ data: { customerProfileId: abena.id, cuisine: "nigerian", sentiment: "LIKE", score: 75, source: "EXPLICIT" } });
    await db.cuisinePreference.create({ data: { customerProfileId: abena.id, cuisine: "indian", sentiment: "DISLIKE", score: 20, source: "EXPLICIT" } });
  }

  // Allergy records.
  const existingAllergy = await db.allergyRecord.count({ where: { customerProfileId: abena.id } });
  if (existingAllergy === 0) {
    await db.allergyRecord.create({ data: { customerProfileId: abena.id, allergenCode: "PEANUTS", severity: "SEVERE", crossContaminationTolerant: false, physicianNotes: "Carries EpiPen", emergencyContact: "+233245550999" } });
  }

  // Nutrition goals.
  const existingGoal = await db.nutritionGoal.count({ where: { customerProfileId: abena.id } });
  if (existingGoal === 0) {
    await db.nutritionGoal.create({ data: { customerProfileId: abena.id, type: "WEIGHT_LOSS", targets: JSON.stringify({ calories: 1800, protein: 100, carbs: 150, fat: 60 }) } });
  }

  // Address.
  const existingAddr = await db.customerAddress.count({ where: { customerProfileId: abena.id } });
  if (existingAddr === 0) {
    const addr = await db.customerAddress.create({ data: { customerProfileId: abena.id, type: "HOME", label: "Home", line1: "12 Liberation Road", city: "Accra", region: "East Legon", country: "Ghana", lat: 5.645, lng: -0.181, isPrimary: true, isVerified: true } });
    await db.deliveryInstruction.create({ data: { addressId: addr.id, buildingAccess: JSON.stringify({ gateCode: "4421", floor: "2nd" }), landmarks: JSON.stringify(["near A&C Mall"]), notes: "Doorbell is broken, please call on arrival" } });
  }

  // Meal history.
  const existingHistory = await db.mealHistory.count({ where: { customerProfileId: abena.id } });
  if (existingHistory === 0) {
    for (let i = 0; i < 5; i++) {
      await db.mealHistory.create({ data: { organizationId: org.id, customerProfileId: abena.id, householdId: household.id, mealType: "RECIPE", mealName: ["Jollof Rice", "Banku & Tilapia", "Fufu & Light Soup", "Red Red", "Waakye"][i], consumedAt: new Date(Date.now() - i * 86400000), rating: 4 + (i % 2), satisfaction: 4 + (i % 2), nutritionSummary: JSON.stringify({ calories: 420 + i * 50, protein: 15 + i * 3 }) } });
    }
  }

  // Meal plan.
  const existingPlan = await db.mealPlan.count({ where: { householdId: household.id } });
  if (existingPlan === 0) {
    const plan = await db.mealPlan.create({ data: { householdId: household.id, organizationId: org.id, name: "Week 1", type: "WEEKLY", startDate: new Date(), endDate: new Date(Date.now() + 7 * 86400000), status: "ACTIVE" } });
    await db.mealCalendar.create({ data: { mealPlanId: plan.id, dayOfWeek: 1, mealType: "BREAKFAST", mealName: "Hausa Koko" } });
    await db.mealCalendar.create({ data: { mealPlanId: plan.id, dayOfWeek: 1, mealType: "LUNCH", mealName: "Jollof Rice" } });
    await db.mealCalendar.create({ data: { mealPlanId: plan.id, dayOfWeek: 1, mealType: "DINNER", mealName: "Banku & Tilapia" } });
    await db.mealCalendar.create({ data: { mealPlanId: plan.id, dayOfWeek: 2, mealType: "BREAKFAST", mealName: "Tea & Bread" } });
    await db.mealCalendar.create({ data: { mealPlanId: plan.id, dayOfWeek: 2, mealType: "LUNCH", mealName: "Waakye" } });
  }

  // Shopping list.
  const existingList = await db.shoppingList.count({ where: { householdId: household.id } });
  if (existingList === 0) {
    const list = await db.shoppingList.create({ data: { householdId: household.id, organizationId: org.id, name: "Weekly Shopping", status: "ACTIVE", createdById: abena.id } });
    await db.shoppingListItem.create({ data: { shoppingListId: list.id, name: "Rice 5kg", ingredientCode: "FC-RICE-001", quantity: 1, unit: "bag", status: "PENDING", addedById: abena.id } });
    await db.shoppingListItem.create({ data: { shoppingListId: list.id, name: "Tomatoes 2kg", ingredientCode: "FC-TOM-001", quantity: 2, unit: "kg", status: "PENDING", addedById: abena.id } });
    await db.shoppingListItem.create({ data: { shoppingListId: list.id, name: "Vegetable Oil 1L", ingredientCode: "FC-OIL-001", quantity: 1, unit: "L", status: "PURCHASED", addedById: abena.id, completedById: abena.id, completedAt: new Date() } });
  }

  // Pantry.
  const existingPantry = await db.pantry.count({ where: { householdId: household.id } });
  if (existingPantry === 0) {
    const pantry = await db.pantry.create({ data: { householdId: household.id, organizationId: org.id, name: "Main Pantry" } });
    await db.pantryItem.create({ data: { pantryId: pantry.id, name: "Rice", ingredientCode: "FC-RICE-001", quantity: 3000, unit: "g", status: "IN_STOCK", expirationDate: new Date(Date.now() + 300 * 86400000), addedById: abena.id } });
    await db.pantryItem.create({ data: { pantryId: pantry.id, name: "Tomatoes", ingredientCode: "FC-TOM-001", quantity: 500, unit: "g", status: "EXPIRING", expirationDate: new Date(Date.now() + 2 * 86400000), addedById: abena.id } });
    await db.pantryItem.create({ data: { pantryId: pantry.id, name: "Onions", ingredientCode: "FC-ONION-001", quantity: 800, unit: "g", status: "IN_STOCK", expirationDate: new Date(Date.now() + 14 * 86400000), addedById: abena.id } });
  }

  // Favorites.
  const existingFav = await db.customerFavorite.count({ where: { customerProfileId: abena.id } });
  if (existingFav === 0) {
    const recipe = await db.recipe.findFirst();
    if (recipe) {
      await db.customerFavorite.create({ data: { customerProfileId: abena.id, entityType: "RECIPE", entityId: recipe.id, collection: "Ghanaian Favorites" } });
    }
    await db.customerFavorite.create({ data: { customerProfileId: abena.id, entityType: "CUISINE", entityId: "ghanaian" } });
  }

  // Reviews.
  const existingReview = await db.review.count({ where: { customerProfileId: abena.id } });
  if (existingReview === 0) {
    const recipe = await db.recipe.findFirst();
    if (recipe) {
      await db.review.create({ data: { organizationId: org.id, customerProfileId: abena.id, entityType: "RECIPE", entityId: recipe.id, rating: 5, title: "Perfect jollof!", comment: "This recipe never fails. The whole family loved it.", status: "PUBLISHED" } });
      await db.rating.create({ data: { organizationId: org.id, customerProfileId: abena.id, entityType: "RECIPE", entityId: recipe.id, rating: 5 } });
    }
  }

  return {
    households: await db.household.count(),
    householdMembers: await db.householdMember.count(),
    customerProfiles: await db.customerProfile.count(),
    preferences: await db.customerPreference.count(),
    cuisinePreferences: await db.cuisinePreference.count(),
    allergyRecords: await db.allergyRecord.count(),
    nutritionGoals: await db.nutritionGoal.count(),
    addresses: await db.customerAddress.count(),
    mealHistory: await db.mealHistory.count(),
    mealPlans: await db.mealPlan.count(),
    mealCalendar: await db.mealCalendar.count(),
    shoppingLists: await db.shoppingList.count(),
    shoppingListItems: await db.shoppingListItem.count(),
    pantries: await db.pantry.count(),
    pantryItems: await db.pantryItem.count(),
    favorites: await db.customerFavorite.count(),
    reviews: await db.review.count(),
    ratings: await db.rating.count(),
  };
}
