import { describe, expect, it } from "vitest";

/**
 * LocalizedEntity — a minimal per-entity localization container that
 * stores localized names/descriptions per language and resolves the
 * best match for a requested language with a configurable fallback
 * chain. Powers the canonical-data-model localization surface. Implemented
 * in-file for testing the pure-logic contract before the production
 * entity ships under @eks/food-domain.
 *
 * Resolution order for a requested language `lang`:
 *  1. Exact match in the requested language.
 *  2. Walk the configured fallback chain in order (e.g. ["tw", "ak", "en"]):
 *     return the first entry that has a translation.
 *  3. Default language (configured at construction).
 *  4. Any available translation (deterministic: alphabetically first).
 *  5. `undefined` when no translation exists at all.
 */

export class LocalizedEntity {
  private readonly defaultLang: string;
  private readonly fallbackChain: readonly string[];
  private readonly nameByLang = new Map<string, string>();
  private readonly descByLang = new Map<string, string>();

  constructor(defaultLang: string, fallbackChain: readonly string[] = []) {
    this.defaultLang = defaultLang;
    this.fallbackChain = fallbackChain;
  }

  setName(lang: string, value: string): this {
    this.nameByLang.set(lang, value);
    return this;
  }

  setDescription(lang: string, value: string): this {
    this.descByLang.set(lang, value);
    return this;
  }

  /** Resolve the best-matching name for the requested language. */
  resolveName(lang: string): string | undefined {
    return this.resolve(this.nameByLang, lang);
  }

  /** Resolve the best-matching description for the requested language. */
  resolveDescription(lang: string): string | undefined {
    return this.resolve(this.descByLang, lang);
  }

  /** All languages for which at least one field (name or description) is set. */
  availableLanguages(): string[] {
    const set = new Set<string>();
    for (const l of this.nameByLang.keys()) set.add(l);
    for (const l of this.descByLang.keys()) set.add(l);
    return Array.from(set).sort();
  }

  /** The configured default language. */
  getDefaultLanguage(): string {
    return this.defaultLang;
  }

  /** The configured fallback chain (in order). */
  getFallbackChain(): readonly string[] {
    return this.fallbackChain;
  }

  private resolve(map: ReadonlyMap<string, string>, lang: string): string | undefined {
    // 1. Exact match.
    const exact = map.get(lang);
    if (exact !== undefined) {
      return exact;
    }
    // 2. Fallback chain.
    for (const candidate of this.fallbackChain) {
      const v = map.get(candidate);
      if (v !== undefined) {
        return v;
      }
    }
    // 3. Default language.
    const def = map.get(this.defaultLang);
    if (def !== undefined) {
      return def;
    }
    // 4. Any available translation (deterministic: alphabetically first key).
    const keys = Array.from(map.keys()).sort();
    if (keys.length === 0) {
      return undefined;
    }
    return map.get(keys[0]);
  }
}

describe("LocalizedEntity — exact language match", () => {
  it("returns the name in the requested language when present", () => {
    const e = new LocalizedEntity("en", ["tw", "ak", "en"])
      .setName("en", "Jollof Rice")
      .setName("tw", "Jollof Alɔ")
      .setName("ak", "Jollof Aka");
    expect(e.resolveName("en")).toBe("Jollof Rice");
    expect(e.resolveName("tw")).toBe("Jollof Alɔ");
    expect(e.resolveName("ak")).toBe("Jollof Aka");
  });

  it("returns the description in the requested language when present", () => {
    const e = new LocalizedEntity("en", [])
      .setDescription("en", "Spicy tomato rice")
      .setDescription("fr", "Riz épicé à la tomate");
    expect(e.resolveDescription("en")).toBe("Spicy tomato rice");
    expect(e.resolveDescription("fr")).toBe("Riz épicé à la tomate");
  });

  it("returns undefined for a field that was never set in any language", () => {
    const e = new LocalizedEntity("en", ["tw", "en"]).setName("en", "Jollof Rice");
    expect(e.resolveDescription("en")).toBeUndefined();
  });
});

describe("LocalizedEntity — fallback to default when requested language is missing", () => {
  it("falls back to the default language when the requested language is missing", () => {
    const e = new LocalizedEntity("en", ["tw", "ak"]).setName("en", "Jollof Rice");
    // 'de' is neither requested-present nor in the fallback chain.
    expect(e.resolveName("de")).toBe("Jollof Rice");
  });

  it("falls back to the default language when the requested language has no entry but the default does", () => {
    const e = new LocalizedEntity("en", ["tw", "ak"])
      .setName("en", "Fried Plantain")
      .setName("tw", "Kelewele");
    // 'fr' not present; chain has 'tw' and 'ak' (only 'tw' present) → returns 'tw' first.
    expect(e.resolveName("fr")).toBe("Kelewele");
  });

  it("default language wins over the catch-all 'any available' rule", () => {
    const e = new LocalizedEntity("en", [])
      .setName("fr", "Riz Jollof")
      .setName("de", "Jollof Reis");
    // 'tw' requested; no chain; default 'en' missing → fall to 'any' (alphabetical first = 'de').
    expect(e.resolveName("tw")).toBe("Jollof Reis");
  });
});

describe("LocalizedEntity — fallback chain (tw → en)", () => {
  it("walks the fallback chain when the requested language is missing", () => {
    const e = new LocalizedEntity("en", ["tw", "ak", "en"])
      .setName("en", "Jollof Rice")
      .setName("ak", "Jollof Aka");
    // 'tw' requested but only 'en' and 'ak' are set. Chain: tw (missing) → ak (hit).
    expect(e.resolveName("tw")).toBe("Jollof Aka");
  });

  it("the first matching entry in the fallback chain wins", () => {
    const e = new LocalizedEntity("en", ["tw", "ak", "en"])
      .setName("tw", "Jollof Twi")
      .setName("ak", "Jollof Aka")
      .setName("en", "Jollof Rice");
    // 'fr' requested → walk chain: tw (hit) → return 'tw' value, even though ak and en are also present.
    expect(e.resolveName("fr")).toBe("Jollof Twi");
  });

  it("falls all the way through the chain to the default when no chain entry matches", () => {
    const e = new LocalizedEntity("en", ["tw", "ak"])
      .setName("en", "Jollof Rice");
    // 'fr' requested → walk chain (tw missing, ak missing) → default 'en' (hit).
    expect(e.resolveName("fr")).toBe("Jollof Rice");
  });

  it("returns undefined when nothing matches and no translation exists at all", () => {
    const e = new LocalizedEntity("en", ["tw", "ak"]);
    // No name set in any language.
    expect(e.resolveName("fr")).toBeUndefined();
  });

  it("the fallback chain works independently for name and description", () => {
    const e = new LocalizedEntity("en", ["tw", "en"])
      .setName("en", "Jollof Rice")
      .setName("tw", "Jollof Twi")
      .setDescription("en", "Spicy tomato rice");
    // 'tw' requested: name matches exactly (Twi), description falls back to en.
    expect(e.resolveName("tw")).toBe("Jollof Twi");
    expect(e.resolveDescription("tw")).toBe("Spicy tomato rice");
  });
});

describe("LocalizedEntity — listing all available languages", () => {
  it("lists all languages for which at least one field is set, sorted", () => {
    const e = new LocalizedEntity("en", ["tw", "ak"])
      .setName("en", "Jollof Rice")
      .setName("tw", "Jollof Twi")
      .setDescription("fr", "Riz Jollof");
    expect(e.availableLanguages()).toEqual(["en", "fr", "tw"]);
  });

  it("returns an empty array when nothing is set", () => {
    const e = new LocalizedEntity("en", ["tw"]);
    expect(e.availableLanguages()).toEqual([]);
  });

  it("does not list a language twice when both name and description are set for it", () => {
    const e = new LocalizedEntity("en", [])
      .setName("en", "Jollof Rice")
      .setDescription("en", "Spicy tomato rice");
    expect(e.availableLanguages()).toEqual(["en"]);
  });

  it("exposes the configured default language and fallback chain", () => {
    const e = new LocalizedEntity("en", ["tw", "ak", "ga"]);
    expect(e.getDefaultLanguage()).toBe("en");
    expect(e.getFallbackChain()).toEqual(["tw", "ak", "ga"]);
  });
});

describe("LocalizedEntity — fluent setters return this", () => {
  it("setName returns the entity for chaining", () => {
    const e = new LocalizedEntity("en", []);
    const ret = e.setName("en", "Jollof Rice");
    expect(ret).toBe(e);
  });

  it("setDescription returns the entity for chaining", () => {
    const e = new LocalizedEntity("en", []);
    const ret = e.setDescription("en", "Spicy tomato rice");
    expect(ret).toBe(e);
  });

  it("supports a fully chained construction", () => {
    const e = new LocalizedEntity("en", ["tw", "en"])
      .setName("en", "Jollof Rice")
      .setName("tw", "Jollof Twi")
      .setDescription("en", "Spicy tomato rice");
    expect(e.resolveName("en")).toBe("Jollof Rice");
    expect(e.resolveName("tw")).toBe("Jollof Twi");
    expect(e.resolveDescription("en")).toBe("Spicy tomato rice");
    expect(e.availableLanguages()).toEqual(["en", "tw"]);
  });
});
