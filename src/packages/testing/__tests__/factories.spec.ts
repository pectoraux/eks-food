import { describe, expect, it } from "vitest";
import {
  factory,
  makeEmailAddress,
  makeGeoPoint,
  makeISODate,
  makeMoney,
  makeResult,
  makeUuid,
} from "../factories";

describe("factory", () => {
  it("returns defaults when called with no overrides", () => {
    const makeUser = factory({
      id: "u_1",
      name: "Amara",
      role: "cook" as const,
    });
    expect(makeUser()).toEqual({ id: "u_1", name: "Amara", role: "cook" });
  });

  it("merges overrides over defaults without mutating defaults", () => {
    const defaults = { id: "u_1", name: "Amara", age: 30 };
    const makeUser = factory(defaults);
    const overridden = makeUser({ name: "Kwame", age: 41 });
    expect(overridden).toEqual({ id: "u_1", name: "Kwame", age: 41 });
    // Defaults are untouched.
    expect(defaults).toEqual({ id: "u_1", name: "Amara", age: 30 });
    expect(makeUser().name).toBe("Amara");
  });

  it("produces independent object instances", () => {
    const makePoint = factory({ x: 0, y: 0 });
    const a = makePoint({ x: 1 });
    const b = makePoint({ x: 2 });
    expect(a).not.toBe(b);
    expect(a.x).toBe(1);
    expect(b.x).toBe(2);
  });
});

describe("makeUuid", () => {
  it("returns a stable UUID for the same seed", () => {
    const a = makeUuid("amara");
    const b = makeUuid("amara");
    expect(a).toBe(b);
  });

  it("returns distinct UUIDs for different seeds", () => {
    expect(makeUuid("amara")).not.toBe(makeUuid("kwame"));
  });

  it("produces a valid v4-format UUID when no seed is given", () => {
    const uuid = makeUuid();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("generates unique UUIDs across calls when unseeded", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(makeUuid());
    expect(seen.size).toBe(1000);
  });
});

describe("makeMoney", () => {
  it("returns the default amount and currency when called with no args", () => {
    expect(makeMoney()).toEqual({ amount: 1000, currency: "GHS" });
  });

  it("merges overrides while keeping non-overridden fields", () => {
    expect(makeMoney({ amount: 2500 })).toEqual({ amount: 2500, currency: "GHS" });
    expect(makeMoney({ currency: "USD" })).toEqual({ amount: 1000, currency: "USD" });
  });

  it("accepts zero as a valid amount", () => {
    expect(makeMoney({ amount: 0 }).amount).toBe(0);
  });

  it("throws RangeError on negative amounts", () => {
    expect(() => makeMoney({ amount: -1 })).toThrow(RangeError);
    expect(() => makeMoney({ amount: -0.01 })).toThrow(/non-negative/);
  });

  it("throws RangeError on non-finite amounts", () => {
    expect(() => makeMoney({ amount: Number.NaN })).toThrow(RangeError);
    expect(() => makeMoney({ amount: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it("throws RangeError on malformed currency codes", () => {
    expect(() => makeMoney({ currency: "ghs" })).toThrow(RangeError);
    expect(() => makeMoney({ currency: "GH" })).toThrow(RangeError);
    expect(() => makeMoney({ currency: "GHSX" })).toThrow(RangeError);
  });
});

describe("makeGeoPoint", () => {
  it("defaults to central Accra", () => {
    expect(makeGeoPoint()).toEqual({ lat: 5.6037, lng: -0.187 });
  });

  it("merges overrides", () => {
    expect(makeGeoPoint({ lat: 6.6 })).toEqual({ lat: 6.6, lng: -0.187 });
  });

  it("rejects out-of-range coordinates", () => {
    expect(() => makeGeoPoint({ lat: 91 })).toThrow(RangeError);
    expect(() => makeGeoPoint({ lat: -91 })).toThrow(RangeError);
    expect(() => makeGeoPoint({ lng: 181 })).toThrow(RangeError);
    expect(() => makeGeoPoint({ lng: -181 })).toThrow(RangeError);
  });

  it("accepts the boundary values", () => {
    expect(makeGeoPoint({ lat: 90, lng: 180 })).toEqual({ lat: 90, lng: 180 });
    expect(makeGeoPoint({ lat: -90, lng: -180 })).toEqual({ lat: -90, lng: -180 });
  });
});

describe("makeEmailAddress", () => {
  it("builds an email from a given local part", () => {
    expect(makeEmailAddress("amara")).toBe("amara@example.com");
    expect(makeEmailAddress("COOK.kwame")).toBe("cook-kwame@example.com");
  });

  it("strips illegal characters from the local part", () => {
    expect(makeEmailAddress("amara!@#$%")).toBe("amara@example.com");
    expect(makeEmailAddress("  zainab  ")).toBe("zainab@example.com");
  });

  it("produces a unique, deterministic-by-counter email when no local is given", () => {
    const a = makeEmailAddress();
    const b = makeEmailAddress();
    expect(a).toMatch(/^user\d+@example\.com$/);
    expect(b).toMatch(/^user\d+@example\.com$/);
    expect(a).not.toBe(b);
  });
});

describe("makeISODate", () => {
  it("returns a stable default ISO date", () => {
    expect(makeISODate()).toBe("2024-01-01T00:00:00.000Z");
    expect(makeISODate()).toBe(makeISODate());
  });

  it("formats an explicit Date", () => {
    const d = new Date(Date.UTC(2024, 0, 15, 10, 30, 0));
    expect(makeISODate(d)).toBe("2024-01-15T10:30:00.000Z");
  });

  it("formats an explicit epoch ms", () => {
    expect(makeISODate(Date.UTC(2024, 5, 1))).toBe("2024-06-01T00:00:00.000Z");
  });
});

describe("makeResult", () => {
  it("returns ok(1) by default", () => {
    const r = makeResult();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(1);
  });

  it("wraps a provided value in ok()", () => {
    const r = makeResult("hello");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("hello");
  });

  it("builds an err result with (false, error)", () => {
    const r = makeResult(false, { code: "X", message: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("X");
  });

  it("falls back to a default DomainError when err is requested without one", () => {
    const r = makeResult(false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("TEST_ERROR");
  });
});
