import { describe, expect, it } from "vitest";

/**
 * Preference engine — pure-logic reference implementation for the
 * Customer Platform preference-intelligence subsystem.
 *
 * Tracks both EXPLICIT (user-authored) and IMPLICIT (derived from
 * behaviour) food preferences for a single customer. Each preference
 * is a (entityType, entityValue) tuple with:
 *
 *  - score: -100..+100 (negative = dislike, positive = like)
 *  - provenance: where the signal came from
 *  - confidence: 0..1 (how reliable the signal is)
 *  - recordedAt: when the signal was observed
 *
 * Conflict resolution follows the documented rule:
 *  - EXPLICIT signals always override IMPLICIT signals for the same
 *    target.
 *  - Among implicit signals, the highest-confidence wins; on ties the
 *    most recent wins.
 *  - Multiple explicit signals on the same target: the most recent
 *    overrides earlier ones.
 *
 * Implicit derivation from meal history:
 *  - Each recorded meal increments the implicit score for its
 *    cuisine(s) by a fixed step (default +5) under the
 *    IMPLICIT_HISTORY provenance, capped at +80 (implicit signals
 *    never reach the +100 reserved for strong explicit likes).
 *  - Negative explicit dislikes propagate to an implicit dislike
 *    score (-5 step, floor -80) on subsequent meals containing that
 *    cuisine — the engine records the conflict but keeps the explicit
 *    override.
 */

/** Where a preference signal originated. */
export type PreferenceProvenance =
  | "EXPLICIT_SURVEY"
  | "EXPLICIT_UI"
  | "IMPLICIT_FAVORITE"
  | "IMPLICIT_HISTORY"
  | "IMPLICIT_REVIEW"
  | "IMPLICIT_PANTRY"
  | "IMPLICIT_RECOMMENDER";

/** Every preference is scoped to one of these entity kinds. */
export type PreferenceEntityType = "CUISINE" | "INGREDIENT" | "MEAL";

/** The kind of target the preference is about. */
export interface PreferenceTarget {
  readonly entityType: PreferenceEntityType;
  readonly entityValue: string;
}

/** A single recorded preference signal. */
export interface PreferenceSignal {
  readonly entityType: PreferenceEntityType;
  readonly entityValue: string;
  readonly score: number;
  readonly provenance: PreferenceProvenance;
  readonly confidence: number;
  readonly recordedAt: Date;
}

/** A resolved preference: the effective score after conflict resolution. */
export interface ResolvedPreference {
  readonly entityType: PreferenceEntityType;
  readonly entityValue: string;
  readonly score: number;
  readonly provenance: PreferenceProvenance;
  readonly confidence: number;
  readonly signalCount: number;
}

/** A meal-history entry used for implicit derivation. */
export interface MealHistoryEntry {
  readonly mealId: string;
  readonly cuisines: readonly string[];
  readonly ingredients: readonly string[];
  readonly at: Date;
}

class PreferenceEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreferenceEngineError";
  }
}

const EXPLICIT_PROVENANCES: ReadonlySet<PreferenceProvenance> = new Set([
  "EXPLICIT_SURVEY",
  "EXPLICIT_UI",
]);

/** Cap for implicit scores (explicit may reach ±100). */
const IMPLICIT_CAP = 80;
const IMPLICIT_HISTORY_STEP = 5;

function isExplicit(p: PreferenceProvenance): boolean {
  return EXPLICIT_PROVENANCES.has(p);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function targetKey(t: PreferenceTarget): string {
  return `${t.entityType}:${t.entityValue}`;
}

/**
 * Tracks explicit + implicit food preferences for one customer.
 *
 * Conflict resolution is computed lazily on read so the engine can
 * absorb multiple signals for the same target without losing the
 * audit trail.
 */
export class PreferenceEngine {
  private readonly signals = new Map<string, PreferenceSignal[]>();
  private readonly meals: MealHistoryEntry[] = [];

  /**
   * Record an explicit preference. Appends to the audit trail (every
   * explicit signal is preserved so callers can reconstruct the
   * history of the customer's stated preferences). Resolution still
   * picks the most recent explicit signal — see {@link resolve}.
   */
  setExplicit(
    target: PreferenceTarget,
    score: number,
    provenance: PreferenceProvenance = "EXPLICIT_UI",
    at: Date = new Date(),
  ): ResolvedPreference {
    if (!isExplicit(provenance)) {
      throw new PreferenceEngineError(
        `setExplicit requires an EXPLICIT_* provenance, got "${provenance}"`,
      );
    }
    if (!Number.isFinite(score)) {
      throw new PreferenceEngineError(`score must be finite, got: ${score}`);
    }
    const clamped = clamp(Math.round(score), -100, 100);
    const key = targetKey(target);

    // Preserve every prior signal (implicit + explicit) for the
    // audit trail; the most-recent explicit wins at resolution time.
    const prior = this.signals.get(key) ?? [];
    const signal: PreferenceSignal = {
      entityType: target.entityType,
      entityValue: target.entityValue,
      score: clamped,
      provenance,
      confidence: 1,
      recordedAt: at,
    };
    this.signals.set(key, [...prior, signal]);
    return this.resolve(target);
  }

  /**
   * Record an implicit preference signal. Implicit signals accumulate
   * per-target: the engine keeps every observation so the audit trail
   * is complete, but only the strongest (by confidence then recency)
   * contributes to the resolved score.
   */
  recordImplicit(
    target: PreferenceTarget,
    score: number,
    provenance: PreferenceProvenance,
    confidence: number,
    at: Date = new Date(),
  ): ResolvedPreference {
    if (isExplicit(provenance)) {
      throw new PreferenceEngineError(
        `recordImplicit requires an IMPLICIT_* provenance, got "${provenance}"`,
      );
    }
    if (!Number.isFinite(score)) {
      throw new PreferenceEngineError(`score must be finite, got: ${score}`);
    }
    if (confidence < 0 || confidence > 1) {
      throw new PreferenceEngineError(
        `confidence must be in [0,1], got: ${confidence}`,
      );
    }
    const clamped = clamp(Math.round(score), -IMPLICIT_CAP, IMPLICIT_CAP);
    const key = targetKey(target);
    const prior = this.signals.get(key) ?? [];
    const signal: PreferenceSignal = {
      entityType: target.entityType,
      entityValue: target.entityValue,
      score: clamped,
      provenance,
      confidence,
      recordedAt: at,
    };
    this.signals.set(key, [...prior, signal]);
    return this.resolve(target);
  }

  /**
   * Record a meal in the customer's history. Each cuisine mentioned in
   * the meal nudges the implicit-history preference for that cuisine by
   * a fixed positive step (capped at IMPLICIT_CAP). Ingredients do the
   * same for ingredient preferences.
   */
  recordMeal(entry: MealHistoryEntry): void {
    if (!entry.cuisines || entry.cuisines.length === 0) {
      throw new PreferenceEngineError("meal must list at least one cuisine");
    }
    this.meals.push(entry);
    for (const cuisine of entry.cuisines) {
      this.nudgeImplicit(
        { entityType: "CUISINE", entityValue: cuisine },
        IMPLICIT_HISTORY_STEP,
        "IMPLICIT_HISTORY",
        0.6,
        entry.at,
      );
    }
    for (const ingredient of entry.ingredients) {
      this.nudgeImplicit(
        { entityType: "INGREDIENT", entityValue: ingredient },
        IMPLICIT_HISTORY_STEP,
        "IMPLICIT_HISTORY",
        0.5,
        entry.at,
      );
    }
  }

  /**
   * Resolve the effective preference for a target. Explicit signals
   * always win over implicit. Among implicit, the highest-confidence
   * wins (ties broken by recency). If multiple signals of the same
   * provenance exist, the latest is used as the basis and the engine
   * returns the strongest of them.
   */
  resolve(target: PreferenceTarget): ResolvedPreference {
    const key = targetKey(target);
    const list = this.signals.get(key);
    if (!list || list.length === 0) {
      return {
        entityType: target.entityType,
        entityValue: target.entityValue,
        score: 0,
        provenance: "IMPLICIT_HISTORY",
        confidence: 0,
        signalCount: 0,
      };
    }

    const explicits = list.filter((s) => isExplicit(s.provenance));
    if (explicits.length > 0) {
      // Most recent explicit wins outright.
      const winner = explicits[explicits.length - 1];
      if (winner === undefined) {
        throw new PreferenceEngineError("explicit signal missing");
      }
      return {
        entityType: target.entityType,
        entityValue: target.entityValue,
        score: winner.score,
        provenance: winner.provenance,
        confidence: winner.confidence,
        signalCount: list.length,
      };
    }

    // No explicit signal — pick the strongest implicit by confidence
    // (then recency). Implicit signals cap at ±IMPLICIT_CAP.
    let best: PreferenceSignal | undefined;
    for (const s of list) {
      if (!best) {
        best = s;
        continue;
      }
      if (
        s.confidence > best.confidence ||
        (s.confidence === best.confidence &&
          s.recordedAt.getTime() > best.recordedAt.getTime())
      ) {
        best = s;
      }
    }
    if (!best) {
      throw new PreferenceEngineError("no implicit signal found");
    }
    return {
      entityType: target.entityType,
      entityValue: target.entityValue,
      score: best.score,
      provenance: best.provenance,
      confidence: best.confidence,
      signalCount: list.length,
    };
  }

  /** All resolved preferences, sorted by absolute score (descending). */
  listAll(): readonly ResolvedPreference[] {
    const out: ResolvedPreference[] = [];
    for (const key of this.signals.keys()) {
      const [entityType, entityValue] = key.split(":", 2);
      if (!entityType || !entityValue) continue;
      out.push(
        this.resolve({
          entityType: entityType as PreferenceEntityType,
          entityValue,
        }),
      );
    }
    return out.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  }

  /** Snapshot of meal history (chronological). */
  getMealHistory(): readonly MealHistoryEntry[] {
    return [...this.meals];
  }

  /** All raw signals recorded against a target (audit trail). */
  getSignals(target: PreferenceTarget): readonly PreferenceSignal[] {
    return [...(this.signals.get(targetKey(target)) ?? [])];
  }

  /**
   * Nudge an implicit preference by `delta`. Caps the running score at
   * ±IMPLICIT_CAP. Existing implicit signals of the same provenance
   * are merged into a single running signal so the score accumulates
   * rather than fragmenting.
   */
  private nudgeImplicit(
    target: PreferenceTarget,
    delta: number,
    provenance: PreferenceProvenance,
    confidence: number,
    at: Date,
  ): void {
    const key = targetKey(target);
    const prior = this.signals.get(key) ?? [];
    const existingIdx = prior.findIndex(
      (s) => s.provenance === provenance && !isExplicit(provenance),
    );
    if (existingIdx >= 0) {
      const existing = prior[existingIdx];
      if (!existing) {
        throw new PreferenceEngineError("signal missing at index");
      }
      const next: PreferenceSignal = {
        ...existing,
        score: clamp(existing.score + delta, -IMPLICIT_CAP, IMPLICIT_CAP),
        confidence: clamp(confidence, 0, 1),
        recordedAt: at,
      };
      const copy = [...prior];
      copy[existingIdx] = next;
      this.signals.set(key, copy);
    } else {
      const signal: PreferenceSignal = {
        entityType: target.entityType,
        entityValue: target.entityValue,
        score: clamp(delta, -IMPLICIT_CAP, IMPLICIT_CAP),
        provenance,
        confidence: clamp(confidence, 0, 1),
        recordedAt: at,
      };
      this.signals.set(key, [...prior, signal]);
    }
  }
}

describe("PreferenceEngine", () => {
  describe("setExplicit", () => {
    it("records an explicit preference with score in [-100, +100]", () => {
      const eng = new PreferenceEngine();
      const r = eng.setExplicit(
        { entityType: "CUISINE", entityValue: "italian" },
        80,
      );
      expect(r.score).toBe(80);
      expect(r.provenance).toBe("EXPLICIT_UI");
      expect(r.confidence).toBe(1);
      expect(r.signalCount).toBe(1);
    });

    it("clamps scores to the [-100, +100] range", () => {
      const eng = new PreferenceEngine();
      const hi = eng.setExplicit(
        { entityType: "CUISINE", entityValue: "ethiopian" },
        999,
      );
      expect(hi.score).toBe(100);
      const lo = eng.setExplicit(
        { entityType: "CUISINE", entityValue: "ethiopian" },
        -999,
      );
      expect(lo.score).toBe(-100);
    });

    it("accepts EXPLICIT_SURVEY as a provenance", () => {
      const eng = new PreferenceEngine();
      const r = eng.setExplicit(
        { entityType: "INGREDIENT", entityValue: "garlic" },
        40,
        "EXPLICIT_SURVEY",
      );
      expect(r.provenance).toBe("EXPLICIT_SURVEY");
    });

    it("rejects an IMPLICIT provenance", () => {
      const eng = new PreferenceEngine();
      expect(() =>
        eng.setExplicit(
          { entityType: "CUISINE", entityValue: "thai" },
          50,
          "IMPLICIT_HISTORY",
        ),
      ).toThrow(/EXPLICIT_/);
    });

    it("the most recent explicit signal overrides earlier explicit signals for the same target", () => {
      const eng = new PreferenceEngine();
      const t0 = new Date("2024-01-01T00:00:00.000Z");
      const t1 = new Date("2024-02-01T00:00:00.000Z");
      eng.setExplicit(
        { entityType: "CUISINE", entityValue: "indian" },
        30,
        "EXPLICIT_SURVEY",
        t0,
      );
      eng.setExplicit(
        { entityType: "CUISINE", entityValue: "indian" },
        70,
        "EXPLICIT_UI",
        t1,
      );
      const r = eng.resolve({ entityType: "CUISINE", entityValue: "indian" });
      expect(r.score).toBe(70);
      expect(r.provenance).toBe("EXPLICIT_UI");
      // Two explicit signals recorded (audit trail preserved).
      expect(r.signalCount).toBe(2);
    });

    it("rejects non-finite scores", () => {
      const eng = new PreferenceEngine();
      expect(() =>
        eng.setExplicit(
          { entityType: "CUISINE", entityValue: "thai" },
          Number.NaN,
        ),
      ).toThrow(/finite/);
    });
  });

  describe("recordImplicit", () => {
    it("records an implicit signal capped at ±80", () => {
      const eng = new PreferenceEngine();
      const r = eng.recordImplicit(
        { entityType: "CUISINE", entityValue: "ethiopian" },
        150,
        "IMPLICIT_FAVORITE",
        0.8,
      );
      expect(r.score).toBe(80);
    });

    it("rejects an EXPLICIT provenance", () => {
      const eng = new PreferenceEngine();
      expect(() =>
        eng.recordImplicit(
          { entityType: "CUISINE", entityValue: "thai" },
          50,
          "EXPLICIT_UI",
          0.5,
        ),
      ).toThrow(/IMPLICIT_/);
    });

    it("rejects confidence outside [0, 1]", () => {
      const eng = new PreferenceEngine();
      expect(() =>
        eng.recordImplicit(
          { entityType: "CUISINE", entityValue: "thai" },
          50,
          "IMPLICIT_FAVORITE",
          1.5,
        ),
      ).toThrow(/confidence/);
      expect(() =>
        eng.recordImplicit(
          { entityType: "CUISINE", entityValue: "thai" },
          50,
          "IMPLICIT_FAVORITE",
          -0.1,
        ),
      ).toThrow(/confidence/);
    });
  });

  describe("implicit derivation from meal history", () => {
    it("each recorded meal nudges the implicit-history score for its cuisines", () => {
      const eng = new PreferenceEngine();
      const at = new Date("2024-03-01T00:00:00.000Z");
      eng.recordMeal({
        mealId: "m-1",
        cuisines: ["italian"],
        ingredients: ["pasta"],
        at,
      });
      const r = eng.resolve({
        entityType: "CUISINE",
        entityValue: "italian",
      });
      expect(r.score).toBe(IMPLICIT_HISTORY_STEP);
      expect(r.provenance).toBe("IMPLICIT_HISTORY");
      expect(r.signalCount).toBe(1);
    });

    it("accumulates across multiple meals, capped at +80", () => {
      const eng = new PreferenceEngine();
      const cuisines = ["japanese"];
      for (let i = 0; i < 30; i++) {
        eng.recordMeal({
          mealId: `m-${i}`,
          cuisines,
          ingredients: [],
          at: new Date(2024, 0, 1 + i),
        });
      }
      const r = eng.resolve({
        entityType: "CUISINE",
        entityValue: "japanese",
      });
      // 30 * 5 = 150, capped at 80.
      expect(r.score).toBe(80);
      expect(r.provenance).toBe("IMPLICIT_HISTORY");
    });

    it("also nudges ingredient preferences from the meal's ingredients", () => {
      const eng = new PreferenceEngine();
      eng.recordMeal({
        mealId: "m-1",
        cuisines: ["ghanaian"],
        ingredients: ["plantain", "palm-oil"],
        at: new Date("2024-03-01T00:00:00.000Z"),
      });
      const plantain = eng.resolve({
        entityType: "INGREDIENT",
        entityValue: "plantain",
      });
      const palmOil = eng.resolve({
        entityType: "INGREDIENT",
        entityValue: "palm-oil",
      });
      expect(plantain.score).toBe(IMPLICIT_HISTORY_STEP);
      expect(palmOil.score).toBe(IMPLICIT_HISTORY_STEP);
    });

    it("throws when the meal has no cuisines", () => {
      const eng = new PreferenceEngine();
      expect(() =>
        eng.recordMeal({
          mealId: "m-x",
          cuisines: [],
          ingredients: [],
          at: new Date(),
        }),
      ).toThrow(/cuisine/);
    });

    it("preserves the full meal-history audit trail", () => {
      const eng = new PreferenceEngine();
      eng.recordMeal({
        mealId: "m-1",
        cuisines: ["italian"],
        ingredients: [],
        at: new Date("2024-01-01T00:00:00.000Z"),
      });
      eng.recordMeal({
        mealId: "m-2",
        cuisines: ["italian"],
        ingredients: [],
        at: new Date("2024-01-02T00:00:00.000Z"),
      });
      const history = eng.getMealHistory();
      expect(history).toHaveLength(2);
      expect(history.map((h) => h.mealId)).toEqual(["m-1", "m-2"]);
    });
  });

  describe("preference score (resolve)", () => {
    it("returns a zero-score ResolvedPreference for an unknown target", () => {
      const eng = new PreferenceEngine();
      const r = eng.resolve({
        entityType: "CUISINE",
        entityValue: "korean",
      });
      expect(r.score).toBe(0);
      expect(r.confidence).toBe(0);
      expect(r.signalCount).toBe(0);
    });

    it("picks the highest-confidence implicit signal when no explicit exists", () => {
      const eng = new PreferenceEngine();
      const at = new Date("2024-01-01T00:00:00.000Z");
      eng.recordImplicit(
        { entityType: "CUISINE", entityValue: "thai" },
        20,
        "IMPLICIT_FAVORITE",
        0.4,
        at,
      );
      eng.recordImplicit(
        { entityType: "CUISINE", entityValue: "thai" },
        40,
        "IMPLICIT_REVIEW",
        0.9,
        at,
      );
      const r = eng.resolve({ entityType: "CUISINE", entityValue: "thai" });
      expect(r.score).toBe(40);
      expect(r.provenance).toBe("IMPLICIT_REVIEW");
      expect(r.confidence).toBe(0.9);
      expect(r.signalCount).toBe(2);
    });

    it("breaks confidence ties by recency (latest wins)", () => {
      const eng = new PreferenceEngine();
      const early = new Date("2024-01-01T00:00:00.000Z");
      const late = new Date("2024-02-01T00:00:00.000Z");
      eng.recordImplicit(
        { entityType: "CUISINE", entityValue: "vietnamese" },
        20,
        "IMPLICIT_FAVORITE",
        0.5,
        early,
      );
      eng.recordImplicit(
        { entityType: "CUISINE", entityValue: "vietnamese" },
        50,
        "IMPLICIT_PANTRY",
        0.5,
        late,
      );
      const r = eng.resolve({
        entityType: "CUISINE",
        entityValue: "vietnamese",
      });
      expect(r.score).toBe(50);
      expect(r.provenance).toBe("IMPLICIT_PANTRY");
    });
  });

  describe("conflict resolution (explicit vs implicit)", () => {
    it("an explicit DISLIKE overrides accumulated implicit LIKEs for the same target", () => {
      const eng = new PreferenceEngine();
      // Build a strong implicit LIKE via meal history.
      for (let i = 0; i < 10; i++) {
        eng.recordMeal({
          mealId: `m-${i}`,
          cuisines: ["mexican"],
          ingredients: [],
          at: new Date(2024, 0, 1 + i),
        });
      }
      // 10 * 5 = 50 implicit LIKE.
      expect(
        eng.resolve({ entityType: "CUISINE", entityValue: "mexican" }).score,
      ).toBe(50);

      // Now the customer explicitly says they don't like mexican.
      eng.setExplicit(
        { entityType: "CUISINE", entityValue: "mexican" },
        -90,
        "EXPLICIT_SURVEY",
      );
      const r = eng.resolve({ entityType: "CUISINE", entityValue: "mexican" });
      expect(r.score).toBe(-90);
      expect(r.provenance).toBe("EXPLICIT_SURVEY");
      // Implicit signals are preserved in the audit trail.
      expect(r.signalCount).toBeGreaterThan(1);
    });

    it("an explicit LIKE overrides a single implicit DISLIKE", () => {
      const eng = new PreferenceEngine();
      eng.recordImplicit(
        { entityType: "INGREDIENT", entityValue: "cilantro" },
        -60,
        "IMPLICIT_REVIEW",
        0.7,
      );
      eng.setExplicit(
        { entityType: "INGREDIENT", entityValue: "cilantro" },
        80,
        "EXPLICIT_UI",
      );
      const r = eng.resolve({
        entityType: "INGREDIENT",
        entityValue: "cilantro",
      });
      expect(r.score).toBe(80);
      expect(r.provenance).toBe("EXPLICIT_UI");
    });

    it("updating an explicit signal appends to the audit trail (latest wins at resolution)", () => {
      const eng = new PreferenceEngine();
      eng.setExplicit(
        { entityType: "CUISINE", entityValue: "lebanese" },
        50,
        "EXPLICIT_SURVEY",
      );
      eng.setExplicit(
        { entityType: "CUISINE", entityValue: "lebanese" },
        75,
        "EXPLICIT_UI",
      );
      const signals = eng.getSignals({
        entityType: "CUISINE",
        entityValue: "lebanese",
      });
      const explicits = signals.filter((s) =>
        isExplicit(s.provenance),
      );
      // Both explicit signals are preserved in the audit trail.
      expect(explicits).toHaveLength(2);
      // The most recent explicit wins at resolution time.
      const resolved = eng.resolve({
        entityType: "CUISINE",
        entityValue: "lebanese",
      });
      expect(resolved.score).toBe(75);
      expect(resolved.provenance).toBe("EXPLICIT_UI");
    });

    it("implicit signals on the same target survive an explicit override (audit trail)", () => {
      const eng = new PreferenceEngine();
      eng.recordImplicit(
        { entityType: "CUISINE", entityValue: "french" },
        30,
        "IMPLICIT_FAVORITE",
        0.6,
      );
      eng.setExplicit(
        { entityType: "CUISINE", entityValue: "french" },
        -20,
        "EXPLICIT_UI",
      );
      const signals = eng.getSignals({
        entityType: "CUISINE",
        entityValue: "french",
      });
      const implicits = signals.filter((s) => !isExplicit(s.provenance));
      expect(implicits).toHaveLength(1);
      expect(implicits[0]?.score).toBe(30);
    });
  });

  describe("listAll", () => {
    it("returns all resolved preferences sorted by absolute score (descending)", () => {
      const eng = new PreferenceEngine();
      eng.setExplicit(
        { entityType: "CUISINE", entityValue: "italian" },
        90,
      );
      eng.setExplicit(
        { entityType: "CUISINE", entityValue: "british" },
        -70,
      );
      eng.recordImplicit(
        { entityType: "CUISINE", entityValue: "thai" },
        30,
        "IMPLICIT_FAVORITE",
        0.5,
      );
      const all = eng.listAll();
      expect(all).toHaveLength(3);
      expect(all.map((p) => p.entityValue)).toEqual([
        "italian",
        "british",
        "thai",
      ]);
    });
  });

  describe("end-to-end lifecycle", () => {
    it("survey → meal history → survey update resolves correctly", () => {
      const eng = new PreferenceEngine();
      // Initial explicit LIKE from a survey.
      eng.setExplicit(
        { entityType: "CUISINE", entityValue: "indian" },
        50,
        "EXPLICIT_SURVEY",
        new Date("2024-01-01T00:00:00.000Z"),
      );
      // Customer eats indian 5 times (would push implicit to +25).
      for (let i = 0; i < 5; i++) {
        eng.recordMeal({
          mealId: `m-${i}`,
          cuisines: ["indian"],
          ingredients: [],
          at: new Date(2024, 1, 1 + i),
        });
      }
      // Explicit (50) should still win.
      let r = eng.resolve({ entityType: "CUISINE", entityValue: "indian" });
      expect(r.score).toBe(50);
      expect(r.provenance).toBe("EXPLICIT_SURVEY");

      // Customer updates the explicit preference to a stronger LIKE.
      eng.setExplicit(
        { entityType: "CUISINE", entityValue: "indian" },
        95,
        "EXPLICIT_UI",
        new Date("2024-03-01T00:00:00.000Z"),
      );
      r = eng.resolve({ entityType: "CUISINE", entityValue: "indian" });
      expect(r.score).toBe(95);
      expect(r.provenance).toBe("EXPLICIT_UI");
      // Audit trail shows: 2 explicit (latest wins) + 1 implicit-history
      // (collapsed from 5 meals via accumulation).
      expect(r.signalCount).toBe(3);
    });
  });
});
