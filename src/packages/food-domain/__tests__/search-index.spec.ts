import { describe, expect, it } from "vitest";

/**
 * SearchIndex — a minimal in-process inverted index that powers the
 * food-domain search surface. Implemented in-file for testing the
 * pure-logic contract before the production engine ships under
 * @eks/food-domain.
 *
 * Responsibilities:
 *  - index(entityId, fields, facets?) — index an entity's text fields
 *    (a single string OR a record of fieldName→text, which supports
 *    multilingual fields like `name_en`, `name_tw`) plus optional
 *    facets (e.g. `{ cuisine: "Ghanaian", category: "main" }`).
 *  - search(query, filters?) — full-text AND search across every
 *    indexed field of every entity, with optional faceted filtering
 *    and fuzzy matching (edit distance ≤ 1 per token). Returns
 *    `{ entityId, score }` results sorted by descending score.
 *  - autocomplete(prefix, limit?) — return distinct indexed tokens
 *    that start with the given prefix, sorted alphabetically.
 *
 * Tokenization: split on whitespace + punctuation, lowercase. All
 * tokens across all fields are merged into a single per-document
 * token set; the inverted index maps token→Set<entityId>.
 */

export interface SearchResult {
  readonly entityId: string;
  readonly score: number;
  readonly matchedTokens: readonly string[];
}

export type IndexedFields = string | Readonly<Record<string, string>>;
export type FacetFilters = Readonly<Record<string, string>>;

interface IndexedDoc {
  readonly entityId: string;
  readonly tokens: ReadonlySet<string>;
  readonly facets: Readonly<Record<string, string>>;
  readonly fields: Readonly<Record<string, string>>;
}

export class SearchIndex {
  private readonly docs = new Map<string, IndexedDoc>();
  private readonly inverted = new Map<string, Set<string>>();

  index(entityId: string, fields: IndexedFields, facets: FacetFilters = {}): void {
    const fieldMap: Record<string, string> =
      typeof fields === "string" ? { _default: fields } : { ...fields };

    const tokens = new Set<string>();
    for (const value of Object.values(fieldMap)) {
      for (const tok of tokenize(value)) {
        tokens.add(tok);
      }
    }

    // Remove the previous entry for this entityId (if any) so re-indexing
    // does not leave stale tokens in the inverted index.
    const previous = this.docs.get(entityId);
    if (previous) {
      for (const tok of previous.tokens) {
        const set = this.inverted.get(tok);
        if (set) {
          set.delete(entityId);
          if (set.size === 0) {
            this.inverted.delete(tok);
          }
        }
      }
    }

    this.docs.set(entityId, { entityId, tokens, facets: { ...facets }, fields: fieldMap });
    for (const tok of tokens) {
      const set = this.inverted.get(tok) ?? new Set<string>();
      set.add(entityId);
      this.inverted.set(tok, set);
    }
  }

  search(query: string, filters: FacetFilters = {}): SearchResult[] {
    const qTokens = tokenize(query);
    if (qTokens.length === 0) {
      return [];
    }

    const results: SearchResult[] = [];

    for (const doc of this.docs.values()) {
      // Faceted filter: every filter key must match exactly.
      let passesFilters = true;
      for (const [key, value] of Object.entries(filters)) {
        if (doc.facets[key] !== value) {
          passesFilters = false;
          break;
        }
      }
      if (!passesFilters) continue;

      // For each query token, find the best matching doc token (exact or
      // edit-distance ≤ 1). Every query token must match at least one
      // doc token for the document to be considered a hit (AND semantics).
      const matchedTokens: string[] = [];
      let score = 0;
      let allMatched = true;

      for (const qt of qTokens) {
        let bestMatch: string | null = null;
        let bestDistance = Infinity;
        for (const dt of doc.tokens) {
          const dist = qt === dt ? 0 : levenshtein(qt, dt);
          if (dist < bestDistance) {
            bestDistance = dist;
            bestMatch = dt;
          }
        }
        // Accept the token iff best distance is ≤ 1.
        if (bestMatch !== null && bestDistance <= 1) {
          matchedTokens.push(bestMatch);
          // Score: 2 points for an exact match, 1 point for a fuzzy match.
          score += bestDistance === 0 ? 2 : 1;
        } else {
          allMatched = false;
          break;
        }
      }

      if (allMatched) {
        results.push({ entityId: doc.entityId, score, matchedTokens });
      }
    }

    // Sort by score descending; ties broken by entityId ascending for determinism.
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0;
    });
    return results;
  }

  autocomplete(prefix: string, limit = 10): string[] {
    const p = prefix.toLowerCase();
    if (p.length === 0) return [];
    const matches = new Set<string>();
    for (const doc of this.docs.values()) {
      for (const value of Object.values(doc.fields)) {
        for (const word of value.split(/[\s.,;:!?'"(){}\[\]]+/u)) {
          if (word.length === 0) continue;
          const lw = word.toLowerCase();
          if (lw.startsWith(p)) {
            matches.add(lw);
          }
        }
      }
    }
    return Array.from(matches).sort().slice(0, limit);
  }

  /** Test helper: number of indexed documents. */
  size(): number {
    return this.docs.size;
  }
}

/** Split text into lowercase word tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s.,;:!?'"(){}\[\]]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Levenshtein edit distance (iterative DP). Used for fuzzy matching
 * with a max distance of 1 in `search()`. Returns the exact distance
 * so the caller can decide the threshold.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const alen = a.length;
  const blen = b.length;
  if (alen === 0) return blen;
  if (blen === 0) return alen;
  // Previous row.
  let prev = new Array<number>(blen + 1);
  for (let j = 0; j <= blen; j++) prev[j] = j;
  for (let i = 1; i <= alen; i++) {
    const curr = new Array<number>(blen + 1);
    curr[0] = i;
    for (let j = 1; j <= blen; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    prev = curr;
  }
  return prev[blen];
}

describe("SearchIndex — full-text search", () => {
  it("indexed entities are found by an exact full-text query", () => {
    const idx = new SearchIndex();
    idx.index("r1", "Jollof Rice with grilled chicken");
    idx.index("r2", "Fried plantain with beans stew");

    const results = idx.search("jollof");
    expect(results.map((r) => r.entityId)).toEqual(["r1"]);
  });

  it("returns results sorted by descending score (exact match > fuzzy)", () => {
    const idx = new SearchIndex();
    idx.index("r1", "jollof rice");          // exact match for "jollof"
    idx.index("r2", "jolof rice with beans"); // fuzzy match for "jollof" (1 edit)
    const results = idx.search("jollof");
    expect(results[0]?.entityId).toBe("r1");
    expect(results[1]?.entityId).toBe("r2");
    expect((results[0]?.score ?? 0)).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it("a multi-token query requires every query token to match (AND semantics)", () => {
    const idx = new SearchIndex();
    idx.index("r1", "jollof rice ghanaian");
    idx.index("r2", "jollof beans nigerian");
    const results = idx.search("jollof rice");
    expect(results.map((r) => r.entityId)).toEqual(["r1"]);
  });

  it("an empty query returns no results", () => {
    const idx = new SearchIndex();
    idx.index("r1", "jollof rice");
    expect(idx.search("")).toEqual([]);
  });

  it("a query for an unknown word returns no results", () => {
    const idx = new SearchIndex();
    idx.index("r1", "jollof rice");
    expect(idx.search("sushi")).toEqual([]);
  });

  it("re-indexing the same entityId replaces the previous document", () => {
    const idx = new SearchIndex();
    idx.index("r1", "jollof rice");
    idx.index("r1", "fried plantain");
    expect(idx.search("jollof")).toEqual([]);
    expect(idx.search("plantain").map((r) => r.entityId)).toEqual(["r1"]);
    expect(idx.size()).toBe(1);
  });
});

describe("SearchIndex — faceted filtering", () => {
  it("filters results by a single facet", () => {
    const idx = new SearchIndex();
    idx.index("r1", "jollof rice", { cuisine: "Ghanaian" });
    idx.index("r2", "jollof rice", { cuisine: "Nigerian" });
    idx.index("r3", "fried rice", { cuisine: "Ghanaian" });

    const results = idx.search("jollof", { cuisine: "Ghanaian" });
    expect(results.map((r) => r.entityId)).toEqual(["r1"]);
  });

  it("filters results by multiple facets (AND)", () => {
    const idx = new SearchIndex();
    idx.index("r1", "jollof rice", { cuisine: "Ghanaian", category: "main" });
    idx.index("r2", "jollof rice", { cuisine: "Ghanaian", category: "side" });
    idx.index("r3", "jollof rice", { cuisine: "Nigerian", category: "main" });

    const results = idx.search("jollof", { cuisine: "Ghanaian", category: "main" });
    expect(results.map((r) => r.entityId)).toEqual(["r1"]);
  });

  it("returns an empty array when no document matches the facet filter", () => {
    const idx = new SearchIndex();
    idx.index("r1", "jollof rice", { cuisine: "Ghanaian" });
    expect(idx.search("jollof", { cuisine: "Japanese" })).toEqual([]);
  });

  it("filters apply even when the query matches multiple documents", () => {
    const idx = new SearchIndex();
    idx.index("r1", "jollof rice ghanaian");
    idx.index("r2", "jollof rice nigerian");
    idx.index("r3", "jollof rice senegalese");
    const results = idx.search("jollof rice", { origin: "west-africa" });
    // No document has the origin facet set, so nothing matches.
    expect(results).toEqual([]);
    // But indexing r1 with the facet makes it match.
    idx.index("r1", "jollof rice ghanaian", { origin: "west-africa" });
    const results2 = idx.search("jollof rice", { origin: "west-africa" });
    expect(results2.map((r) => r.entityId)).toEqual(["r1"]);
  });
});

describe("SearchIndex — autocomplete", () => {
  it("returns distinct indexed tokens that start with the prefix", () => {
    const idx = new SearchIndex();
    idx.index("r1", "jollof rice grilled chicken");
    idx.index("r2", "jollof beans fried plantain");
    const matches = idx.autocomplete("jol");
    expect(matches).toContain("jollof");
    expect(matches.length).toBe(1);
  });

  it("returns matches sorted alphabetically", () => {
    const idx = new SearchIndex();
    idx.index("r1", "grilled fish");
    idx.index("r2", "groundnut soup");
    idx.index("r3", "gari foto");
    const matches = idx.autocomplete("g");
    expect(matches).toEqual(["gari", "grilled", "groundnut"]);
  });

  it("respects the limit argument", () => {
    const idx = new SearchIndex();
    idx.index("r1", "garlic bread");
    idx.index("r2", "garlic soup");
    idx.index("r3", "garlic chicken");
    idx.index("r4", "garlic rice");
    const matches = idx.autocomplete("garlic", 2);
    expect(matches.length).toBe(1); // 'garlic' is the only distinct token
  });

  it("returns an empty array for an unknown prefix", () => {
    const idx = new SearchIndex();
    idx.index("r1", "jollof rice");
    expect(idx.autocomplete("xyz")).toEqual([]);
  });

  it("returns an empty array for an empty prefix", () => {
    const idx = new SearchIndex();
    idx.index("r1", "jollof rice");
    expect(idx.autocomplete("")).toEqual([]);
  });

  it("autocomplete is case-insensitive", () => {
    const idx = new SearchIndex();
    idx.index("r1", "Jollof Rice");
    const matches = idx.autocomplete("JOL");
    expect(matches).toEqual(["jollof"]);
  });
});

describe("SearchIndex — fuzzy search (1 edit distance)", () => {
  it("finds a 1-edit-distance misspelling (jolof → jollof)", () => {
    const idx = new SearchIndex();
    idx.index("r1", "jollof rice");
    const results = idx.search("jolof");
    expect(results.map((r) => r.entityId)).toEqual(["r1"]);
  });

  it("finds a 1-edit-distance misspelling (rice → rise)", () => {
    const idx = new SearchIndex();
    idx.index("r1", "jollof rice");
    const results = idx.search("rise");
    expect(results.map((r) => r.entityId)).toEqual(["r1"]);
  });

  it("does NOT match when edit distance is 2 or more (jollaf vs jollof is 1; jollxx vs jollof is 2+)", () => {
    const idx = new SearchIndex();
    idx.index("r1", "jollof rice");
    // 'jollxx' vs 'jollof': substitutions at positions 4 and 5 → distance 2 → no match.
    expect(idx.search("jollxx")).toEqual([]);
  });

  it("fuzzy matches score lower than exact matches", () => {
    const idx = new SearchIndex();
    idx.index("r1", "jollof rice");          // exact for "jollof"
    idx.index("r2", "jolof rice");           // exact for "jolof", fuzzy for "jollof"
    const results = idx.search("jollof");
    // r1 scores 2 (exact), r2 scores 1 (fuzzy). r1 wins.
    expect(results[0]?.entityId).toBe("r1");
    expect(results[0]?.score).toBe(2);
    expect(results[1]?.entityId).toBe("r2");
    expect(results[1]?.score).toBe(1);
  });

  it("an exact-match query and a fuzzy-match query both find the same entity", () => {
    const idx = new SearchIndex();
    idx.index("r1", "plantain chips");
    expect(idx.search("plantain").map((r) => r.entityId)).toEqual(["r1"]);
    expect(idx.search("plaintain").map((r) => r.entityId)).toEqual(["r1"]);
  });
});

describe("SearchIndex — multilingual fields", () => {
  it("searches across multiple language fields and matches an English query", () => {
    const idx = new SearchIndex();
    idx.index("r1", {
      name_en: "Jollof Rice",
      name_tw: "Jollof Alɔ",
      description_en: "Spicy tomato rice",
    });
    expect(idx.search("jollof").map((r) => r.entityId)).toEqual(["r1"]);
    expect(idx.search("tomato").map((r) => r.entityId)).toEqual(["r1"]);
  });

  it("searches across multiple language fields and matches a Twi query", () => {
    const idx = new SearchIndex();
    idx.index("r1", {
      name_en: "Jollof Rice",
      name_tw: "Jollof Alɔ",
      description_en: "Spicy tomato rice",
    });
    expect(idx.search("alɔ").map((r) => r.entityId)).toEqual(["r1"]);
  });

  it("a multi-token query spanning multiple languages matches", () => {
    const idx = new SearchIndex();
    idx.index("r1", {
      name_en: "Jollof Rice",
      name_tw: "Jollof Alɔ",
    });
    // 'jollof' (English) AND 'alɔ' (Twi) — both tokens exist across the fields.
    const results = idx.search("jollof alɔ");
    expect(results.map((r) => r.entityId)).toEqual(["r1"]);
  });

  it("autocomplete works across multilingual fields", () => {
    const idx = new SearchIndex();
    idx.index("r1", {
      name_en: "Jollof Rice",
      name_tw: "Jollof Alɔ",
    });
    const matches = idx.autocomplete("al");
    expect(matches).toContain("alɔ");
  });

  it("faceted filtering works in combination with multilingual fields", () => {
    const idx = new SearchIndex();
    idx.index("r1", { name_en: "Jollof Rice", name_tw: "Jollof Alɔ" }, { cuisine: "Ghanaian" });
    idx.index("r2", { name_en: "Jollof Rice", name_fr: "Riz Jollof" }, { cuisine: "Senegalese" });
    const results = idx.search("jollof", { cuisine: "Ghanaian" });
    expect(results.map((r) => r.entityId)).toEqual(["r1"]);
  });
});
