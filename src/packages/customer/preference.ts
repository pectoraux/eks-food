/** Preference Service — explicit + implicit food preferences. */
import { db } from "@/lib/db";

export interface PreferenceUpdate {
  customerProfileId: string;
  cuisine?: string;
  sentiment?: string;
  ingredientCode?: string;
  spiceLevel?: number;
}

export class PreferenceService {
  async setCuisinePreference(customerProfileId: string, cuisine: string, sentiment: string, score?: number): Promise<void> {
    await db.cuisinePreference.upsert({
      where: { customerProfileId_cuisine: { customerProfileId, cuisine } },
      update: { sentiment, score: score ?? (sentiment === "LIKE" ? 80 : sentiment === "DISLIKE" ? 20 : 50), source: "EXPLICIT" },
      create: { customerProfileId, cuisine, sentiment, score: score ?? (sentiment === "LIKE" ? 80 : sentiment === "DISLIKE" ? 20 : 50), source: "EXPLICIT" },
    });
  }

  async setIngredientPreference(customerProfileId: string, ingredientCode: string, sentiment: string, score?: number): Promise<void> {
    await db.ingredientPreference.upsert({
      where: { customerProfileId_ingredientCode: { customerProfileId, ingredientCode } },
      update: { sentiment, score: score ?? (sentiment === "LIKE" ? 80 : sentiment === "DISLIKE" ? 20 : 50), source: "EXPLICIT" },
      create: { customerProfileId, ingredientCode, sentiment, score: score ?? (sentiment === "LIKE" ? 80 : sentiment === "DISLIKE" ? 20 : 50), source: "EXPLICIT" },
    });
  }

  async getPreferences(customerProfileId: string): Promise<{ cuisines: readonly unknown[]; ingredients: readonly unknown[]; profile: unknown }> {
    const [cuisines, ingredients, profile] = await Promise.all([
      db.cuisinePreference.findMany({ where: { customerProfileId }, orderBy: { score: "desc" } }),
      db.ingredientPreference.findMany({ where: { customerProfileId }, orderBy: { score: "desc" } }),
      db.customerPreference.findFirst({ where: { customerProfileId } }),
    ]);
    return { cuisines, ingredients, profile };
  }

  async recordImplicitPreference(customerProfileId: string, ingredientCode: string, frequency: number): Promise<void> {
    // Implicit: higher frequency → higher preference score (capped at 80).
    const score = Math.min(80, 30 + frequency * 10);
    await db.ingredientPreference.upsert({
      where: { customerProfileId_ingredientCode: { customerProfileId, ingredientCode } },
      update: { score, source: "IMPLICIT", sentiment: score > 50 ? "LIKE" : "NEUTRAL" },
      create: { customerProfileId, ingredientCode, sentiment: "LIKE", score, source: "IMPLICIT" },
    });
  }
}
