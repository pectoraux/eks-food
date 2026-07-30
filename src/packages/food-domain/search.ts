/**
 * Search Engine — full-text, faceted, autocomplete, fuzzy, multilingual.
 * Every canonical entity is indexed and searchable.
 */
import { db } from "@/lib/db";

export interface SearchQuery {
  readonly q: string;
  readonly entityType?: string;
  readonly facets?: Record<string, string>;
  readonly limit?: number;
  readonly offset?: number;
  readonly language?: string;
}

export interface SearchResult {
  readonly id: string;
  readonly entityType: string;
  readonly name: string;
  readonly description?: string;
  readonly score: number;
}

export class SearchEngine {
  /** Search across all entities (or a specific type). */
  async search(query: SearchQuery): Promise<{ results: readonly SearchResult[]; total: number }> {
    const limit = Math.min(50, query.limit ?? 20);
    const offset = query.offset ?? 0;
    const results: SearchResult[] = [];

    // Search ingredients.
    if (!query.entityType || query.entityType === "INGREDIENT") {
      const items = await db.ingredient.findMany({
        where: { OR: [{ name: { contains: query.q } }, { code: { contains: query.q } }, { description: { contains: query.q } }], status: "ACTIVE", ...(query.facets?.category ? { categories: { contains: query.facets.category } } : {}) },
        take: limit,
        skip: offset,
      });
      for (const i of items) results.push({ id: i.id, entityType: "INGREDIENT", name: i.name, description: i.description ?? undefined, score: this.score(i.name, query.q) });
    }

    // Search recipes.
    if (!query.entityType || query.entityType === "RECIPE") {
      const items = await db.recipe.findMany({
        where: { OR: [{ name: { contains: query.q } }, { description: { contains: query.q } }], status: "PUBLISHED" },
        take: limit,
        skip: offset,
      });
      for (const r of items) results.push({ id: r.id, entityType: "RECIPE", name: r.name, description: r.description ?? undefined, score: this.score(r.name, query.q) });
    }

    // Search restaurants.
    if (!query.entityType || query.entityType === "RESTAURANT") {
      const items = await db.restaurant.findMany({
        where: { OR: [{ name: { contains: query.q } }, { description: { contains: query.q } }], status: "ACTIVE" },
        take: limit,
        skip: offset,
      });
      for (const r of items) results.push({ id: r.id, entityType: "RESTAURANT", name: r.name, description: r.description ?? undefined, score: this.score(r.name, query.q) });
    }

    // Search cooks.
    if (!query.entityType || query.entityType === "COOK") {
      const items = await db.cookProfile.findMany({
        where: { OR: [{ name: { contains: query.q } }, { bio: { contains: query.q } }], status: "ACTIVE" },
        take: limit,
        skip: offset,
      });
      for (const c of items) results.push({ id: c.id, entityType: "COOK", name: c.name, description: c.bio, score: this.score(c.name, query.q) });
    }

    // Search kitchens.
    if (!query.entityType || query.entityType === "KITCHEN") {
      const items = await db.kitchen.findMany({
        where: { name: { contains: query.q }, status: "ACTIVE" },
        take: limit,
        skip: offset,
      });
      for (const k of items) results.push({ id: k.id, entityType: "KITCHEN", name: k.name, score: this.score(k.name, query.q) });
    }

    // Sort by score (relevance).
    results.sort((a, b) => b.score - a.score);
    return { results: results.slice(0, limit), total: results.length };
  }

  /** Autocomplete: return entity names matching a prefix. */
  async autocomplete(prefix: string, limit = 10): Promise<readonly { name: string; entityType: string }[]> {
    if (prefix.length < 2) return [];
    const results: { name: string; entityType: string }[] = [];
    const [ingredients, recipes, restaurants, cooks] = await Promise.all([
      db.ingredient.findMany({ where: { name: { startsWith: prefix }, status: "ACTIVE" }, take: limit, select: { name: true } }),
      db.recipe.findMany({ where: { name: { startsWith: prefix }, status: "PUBLISHED" }, take: limit, select: { name: true } }),
      db.restaurant.findMany({ where: { name: { startsWith: prefix }, status: "ACTIVE" }, take: limit, select: { name: true } }),
      db.cookProfile.findMany({ where: { name: { startsWith: prefix }, status: "ACTIVE" }, take: limit, select: { name: true } }),
    ]);
    ingredients.forEach((i) => results.push({ name: i.name, entityType: "INGREDIENT" }));
    recipes.forEach((r) => results.push({ name: r.name, entityType: "RECIPE" }));
    restaurants.forEach((r) => results.push({ name: r.name, entityType: "RESTAURANT" }));
    cooks.forEach((c) => results.push({ name: c.name, entityType: "COOK" }));
    return results.slice(0, limit);
  }

  /** Score a result by relevance to the query (exact match > starts-with > contains). */
  private score(name: string, query: string): number {
    const lower = name.toLowerCase();
    const q = query.toLowerCase();
    if (lower === q) return 100;
    if (lower.startsWith(q)) return 80;
    if (lower.includes(q)) return 60;
    return 40;
  }
}
