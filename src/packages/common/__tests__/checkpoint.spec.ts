import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * SyncCheckpoint — a cursor + timestamp that tracks how far an
 * incremental sync has progressed. The sync engine persists the
 * checkpoint after every successful batch so the next run resumes
 * from the right place.
 *
 * Behaviour:
 *  - `advance(cursor)` only moves the cursor forward (lexicographically
 *    for string cursors, numerically for numeric cursors). A backward
 *    advance is rejected.
 *  - `reset()` clears the cursor.
 *  - `serialize()` / `deserialize()` round-trip the cursor + timestamp.
 *
 * Implemented in the test file because @eks/integration's sync engine
 * is landing concurrently. This gives us a deterministic,
 * well-tested primitive the runtime can later adopt.
 */

export interface CheckpointSnapshot {
  readonly cursor: string | null;
  readonly updatedAt: number;
  readonly recordCount: number;
}

export interface SyncCheckpointOptions {
  /** Inject now() (default: Date.now). */
  readonly now?: () => number;
}

export class SyncCheckpoint {
  private cursor: string | null;
  private updatedAt: number;
  private recordCount: number;
  private readonly now: () => number;

  constructor(opts: SyncCheckpointOptions = {}) {
    this.cursor = null;
    this.updatedAt = 0;
    this.recordCount = 0;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Current cursor (null when never advanced). */
  get current(): string | null {
    return this.cursor;
  }

  /** Last-advanced wall-clock timestamp. */
  get lastUpdatedAt(): number {
    return this.updatedAt;
  }

  /** Number of records that have flowed through this checkpoint. */
  get count(): number {
    return this.recordCount;
  }

  /**
   * Advance the cursor. Returns true if the cursor moved forward,
   * false if the new cursor was rejected (equal, lexicographically
   * smaller, or empty).
   *
   * Comparison rule: the cursor is treated as an opaque comparable
   * string. Numeric-looking cursors compare numerically (so "9" <
   * "10"); otherwise lexicographic.
   */
  advance(cursor: string, recordCount = 0): boolean {
    if (typeof cursor !== "string" || cursor.length === 0) return false;
    if (this.cursor !== null && !isAfter(cursor, this.cursor)) {
      return false;
    }
    this.cursor = cursor;
    this.updatedAt = this.now();
    this.recordCount += Math.max(0, recordCount);
    return true;
  }

  /** Clear the checkpoint. */
  reset(): void {
    this.cursor = null;
    this.updatedAt = 0;
    this.recordCount = 0;
  }

  /** Serialize to a JSON-safe plain object. */
  serialize(): CheckpointSnapshot {
    return {
      cursor: this.cursor,
      updatedAt: this.updatedAt,
      recordCount: this.recordCount,
    };
  }

  /** Re-hydrate from a serialized snapshot. */
  static deserialize(snap: CheckpointSnapshot, opts?: SyncCheckpointOptions): SyncCheckpoint {
    const cp = new SyncCheckpoint(opts ?? {});
    cp.cursor = snap.cursor;
    cp.updatedAt = snap.updatedAt;
    cp.recordCount = snap.recordCount;
    return cp;
  }
}

/** Compare two cursors; returns true if `next` strictly follows `prev`. */
function isAfter(next: string, prev: string): boolean {
  // If both look numeric, compare numerically (so "9" < "10" holds).
  const nextN = Number(next);
  const prevN = Number(prev);
  if (Number.isFinite(nextN) && Number.isFinite(prevN)) {
    return nextN > prevN;
  }
  return next > prev;
}

describe("SyncCheckpoint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with a null cursor and zero count", () => {
    const cp = new SyncCheckpoint();
    expect(cp.current).toBeNull();
    expect(cp.lastUpdatedAt).toBe(0);
    expect(cp.count).toBe(0);
  });

  it("advance() moves the cursor forward", () => {
    const cp = new SyncCheckpoint();
    expect(cp.advance("2024-01-01T00:00:00Z", 10)).toBe(true);
    expect(cp.current).toBe("2024-01-01T00:00:00Z");
    expect(cp.count).toBe(10);
    expect(cp.lastUpdatedAt).toBe(Date.now());

    expect(cp.advance("2024-01-01T00:01:00Z", 5)).toBe(true);
    expect(cp.current).toBe("2024-01-01T00:01:00Z");
    expect(cp.count).toBe(15);
  });

  it("advance() rejects a backward cursor", () => {
    const cp = new SyncCheckpoint();
    expect(cp.advance("2024-02-01T00:00:00Z")).toBe(true);
    expect(cp.advance("2024-01-01T00:00:00Z")).toBe(false);
    // Cursor unchanged.
    expect(cp.current).toBe("2024-02-01T00:00:00Z");
  });

  it("advance() rejects an equal cursor (no progress)", () => {
    const cp = new SyncCheckpoint();
    expect(cp.advance("cursor-A")).toBe(true);
    expect(cp.advance("cursor-A")).toBe(false);
    expect(cp.current).toBe("cursor-A");
  });

  it("advance() rejects empty / non-string cursors", () => {
    const cp = new SyncCheckpoint();
    expect(cp.advance("")).toBe(false);
    expect(cp.current).toBeNull();
  });

  it("numeric cursors compare numerically (so 9 < 10, not lexicographically)", () => {
    const cp = new SyncCheckpoint();
    expect(cp.advance("9")).toBe(true);
    // Lexicographically "10" < "9", but numerically "10" > "9" — must accept.
    expect(cp.advance("10")).toBe(true);
    expect(cp.advance("11")).toBe(true);
    // Going back to "9" must be rejected.
    expect(cp.advance("9")).toBe(false);
    expect(cp.current).toBe("11");
  });

  it("reset() clears cursor, timestamp, and count", () => {
    const cp = new SyncCheckpoint();
    cp.advance("cursor-A", 5);
    cp.advance("cursor-B", 3);
    expect(cp.current).toBe("cursor-B");
    expect(cp.count).toBe(8);

    cp.reset();
    expect(cp.current).toBeNull();
    expect(cp.lastUpdatedAt).toBe(0);
    expect(cp.count).toBe(0);
  });

  it("serialize/deserialize round-trips the checkpoint", () => {
    const cp = new SyncCheckpoint();
    cp.advance("2024-06-01T00:00:00Z", 42);

    const snap = cp.serialize();
    expect(snap).toEqual({
      cursor: "2024-06-01T00:00:00Z",
      updatedAt: Date.now(),
      recordCount: 42,
    });

    const restored = SyncCheckpoint.deserialize(snap);
    expect(restored.current).toBe("2024-06-01T00:00:00Z");
    expect(restored.lastUpdatedAt).toBe(Date.now());
    expect(restored.count).toBe(42);
  });

  it("serialize/deserialize preserves a null cursor (fresh checkpoint)", () => {
    const cp = new SyncCheckpoint();
    const snap = cp.serialize();
    expect(snap.cursor).toBeNull();
    expect(snap.updatedAt).toBe(0);
    expect(snap.recordCount).toBe(0);

    const restored = SyncCheckpoint.deserialize(snap);
    expect(restored.current).toBeNull();
    expect(restored.count).toBe(0);
  });

  it("deserialized checkpoint can be advanced further", () => {
    const cp = new SyncCheckpoint();
    cp.advance("cursor-A", 10);
    const snap = cp.serialize();

    const restored = SyncCheckpoint.deserialize(snap);
    expect(restored.advance("cursor-B", 5)).toBe(true);
    expect(restored.current).toBe("cursor-B");
    expect(restored.count).toBe(15);
  });

  it("advance() accumulates record counts across calls", () => {
    const cp = new SyncCheckpoint();
    cp.advance("c1", 10);
    cp.advance("c2", 20);
    cp.advance("c3", 5);
    expect(cp.count).toBe(35);
  });

  it("advance() with negative recordCount is treated as zero", () => {
    const cp = new SyncCheckpoint();
    cp.advance("c1", 10);
    expect(cp.advance("c2", -5)).toBe(true);
    expect(cp.count).toBe(10); // -5 ignored, not subtracted
  });

  it("supports an injected now() for fully deterministic timestamps", () => {
    let clock = 1_000;
    const cp = new SyncCheckpoint({ now: () => clock });
    cp.advance("c1");
    expect(cp.lastUpdatedAt).toBe(1_000);
    clock = 2_000;
    cp.advance("c2");
    expect(cp.lastUpdatedAt).toBe(2_000);
  });

  it("serialize/deserialize preserves an injected now() timestamp", () => {
    let clock = 7_000;
    const cp = new SyncCheckpoint({ now: () => clock });
    cp.advance("cursor-X", 1);
    const snap = cp.serialize();
    expect(snap.updatedAt).toBe(7_000);

    // Restore without injecting now — lastUpdatedAt should still be preserved.
    const restored = SyncCheckpoint.deserialize(snap);
    expect(restored.lastUpdatedAt).toBe(7_000);
  });

  it("lexicographic comparison handles ISO timestamps correctly", () => {
    const cp = new SyncCheckpoint();
    expect(cp.advance("2024-01-01T00:00:00.000Z")).toBe(true);
    expect(cp.advance("2024-01-01T00:00:00.001Z")).toBe(true);
    expect(cp.advance("2024-01-01T00:00:00.000Z")).toBe(false);
    expect(cp.advance("2024-12-31T23:59:59.999Z")).toBe(true);
    expect(cp.advance("2024-06-01T00:00:00.000Z")).toBe(false);
  });
});
