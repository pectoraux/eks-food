import { describe, it, expect } from "vitest";
import { money, addMoney, subtractMoney, multiplyMoney, allocateMoney, toMinorUnits, fromMinorUnits, formatMoney } from "../money";
import { uuid, shortId, referenceCode, idempotencyKey } from "../ids";
import { clampLimit, clampOffset, encodeCursor, decodeCursor, toPagedResult, toCursorResult } from "../pagination";
import { ok, err, isOk, isErr, mapResult, flatMap, unwrapOr } from "../result";

describe("money", () => {
  it("creates money with 2dp rounding", () => {
    expect(money(80.005, "GHS").amount).toBe(80.01);
    expect(money(80, "GHS").currency).toBe("GHS");
  });
  it("rejects negative or non-finite amounts", () => {
    expect(() => money(-1, "GHS")).toThrow(RangeError);
    expect(() => money(Infinity, "GHS")).toThrow(RangeError);
  });
  it("adds and subtracts same currency", () => {
    expect(addMoney(money(50, "GHS"), money(30, "GHS")).amount).toBe(80);
    expect(subtractMoney(money(50, "GHS"), money(30, "GHS")).amount).toBe(20);
  });
  it("refuses mismatched currencies", () => {
    expect(() => addMoney(money(1, "GHS"), money(1, "USD"))).toThrow(/Currency mismatch/);
  });
  it("multiplies by a non-negative factor", () => {
    expect(multiplyMoney(money(50, "GHS"), 2).amount).toBe(100);
    expect(() => multiplyMoney(money(50, "GHS"), -1)).toThrow(RangeError);
  });
  it("converts to/from minor units losslessly", () => {
    expect(toMinorUnits(money(80.5, "GHS"))).toBe(8050);
    expect(fromMinorUnits(8050, "GHS").amount).toBe(80.5);
  });
  it("allocates with largest-remainder, no penny lost", () => {
    const parts = allocateMoney(money(100, "GHS"), [1, 1, 1]);
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBe(100);
    expect(parts).toHaveLength(3);
  });
  it("formats with currency symbol", () => {
    expect(formatMoney(money(80, "GHS"))).toBe("₵80");
    expect(formatMoney(money(80.5, "GHS"), { precise: true })).toBe("₵80.50");
  });
});

describe("ids", () => {
  it("uuid is a 36-char v4 string", () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
  it("shortId is 12 chars", () => { expect(shortId()).toHaveLength(12); });
  it("referenceCode has prefix", () => { expect(referenceCode("EKS")).toMatch(/^EKS-[A-Z0-9]{6}$/); });
  it("idempotencyKey is unique and prefixed", () => {
    expect(idempotencyKey()).not.toBe(idempotencyKey());
    expect(idempotencyKey().startsWith("idmp_")).toBe(true);
  });
});

describe("pagination", () => {
  it("clamps limit within bounds", () => {
    expect(clampLimit(50, 100, 20)).toBe(50);
    expect(clampLimit(500, 100, 20)).toBe(100);
    expect(clampLimit(undefined, 100, 20)).toBe(20);
  });
  it("clamps offset to non-negative", () => {
    expect(clampOffset(10)).toBe(10);
    expect(clampOffset(-5)).toBe(0);
  });
  it("round-trips cursors", () => {
    const c = encodeCursor("abc-123" as never, 42);
    expect(decodeCursor(c)?.a).toBe("abc-123");
    expect(decodeCursor(c)?.s).toBe(42);
  });
  it("decodeCursor returns null for invalid input", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("!!!")).toBeNull();
  });
  it("toPagedResult computes hasMore", () => {
    const r = toPagedResult([1, 2, 3], { limit: 3, offset: 0 }, 10);
    expect(r.hasMore).toBe(true);
    expect(r.total).toBe(10);
  });
  it("toCursorResult slices limit+1", () => {
    const items = [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }];
    const r = toCursorResult(items, 3);
    expect(r.items).toHaveLength(3);
    expect(r.hasMore).toBe(true);
    expect(r.nextCursor).not.toBeNull();
  });
});

describe("result", () => {
  it("ok/err type guards", () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
    expect(isErr(err(new Error("x")))).toBe(true);
  });
  it("mapResult transforms success only", () => {
    expect(mapResult(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
  });
  it("flatMap chains", () => {
    expect(flatMap(ok(2), (n) => ok(n + 1))).toEqual({ ok: true, value: 3 });
  });
  it("unwrapOr returns fallback on error", () => {
    expect(unwrapOr(ok(5), 0)).toBe(5);
    expect(unwrapOr(err(new Error("x")), 0)).toBe(0);
  });
});
