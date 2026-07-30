import { describe, expect, it } from "vitest";
import {
  assertDomainError,
  assertErr,
  assertOk,
  assertPaginated,
} from "../assertions";
import { err, ok, type DomainError, type Paginated, type Result } from "../types";
import { SAMPLE_DOMAIN_ERROR } from "../fixtures";

describe("assertOk", () => {
  it("passes on a successful Result and narrows to the value", () => {
    const r: Result<string, DomainError> = ok("hello");
    assertOk(r);
    // After assertOk, TS knows r.value exists.
    if (r.ok) expect(r.value).toBe("hello");
  });

  it("passes on an ok Result whose value is falsy (0)", () => {
    const r: Result<number, DomainError> = ok(0);
    assertOk(r);
    if (r.ok) expect(r.value).toBe(0);
  });

  it("throws on an error Result", () => {
    const r: Result<string, DomainError> = err(SAMPLE_DOMAIN_ERROR);
    expect(() => assertOk(r)).toThrow();
  });
});

describe("assertErr", () => {
  it("passes on an error Result and narrows to the error", () => {
    const r: Result<string, DomainError> = err(SAMPLE_DOMAIN_ERROR);
    assertErr(r);
    if (!r.ok) expect(r.error.code).toBe("BOOKING_NOT_FOUND");
  });

  it("throws on a successful Result", () => {
    const r: Result<string, DomainError> = ok("hello");
    expect(() => assertErr(r)).toThrow();
  });
});

describe("assertDomainError", () => {
  it("passes when the error code matches", () => {
    const r: Result<string, DomainError> = err(SAMPLE_DOMAIN_ERROR);
    assertDomainError(r, "BOOKING_NOT_FOUND");
  });

  it("throws when the error code does not match", () => {
    const r: Result<string, DomainError> = err({
      code: "DIFFERENT_CODE",
      message: "something else",
    });
    expect(() => assertDomainError(r, "BOOKING_NOT_FOUND")).toThrow();
  });

  it("throws on a successful Result", () => {
    const r: Result<string, DomainError> = ok("hello");
    expect(() => assertDomainError(r, "BOOKING_NOT_FOUND")).toThrow();
  });
});

describe("assertPaginated", () => {
  it("passes on a well-formed envelope", () => {
    const list: Paginated<{ id: string }> = {
      items: [{ id: "a" }, { id: "b" }],
      total: 2,
      page: 1,
      pageSize: 10,
    };
    assertPaginated(list);
  });

  it("passes on an empty first page", () => {
    const list: Paginated<never> = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    };
    assertPaginated(list);
  });

  it("passes when items fill the page exactly", () => {
    const list: Paginated<number> = {
      items: [1, 2, 3],
      total: 3,
      page: 1,
      pageSize: 3,
    };
    assertPaginated(list);
  });

  it("throws when items is not an array", () => {
    const list = {
      items: "not-an-array",
      total: 0,
      page: 1,
      pageSize: 10,
    } as unknown as Paginated<unknown>;
    expect(() => assertPaginated(list)).toThrow();
  });

  it("throws when total > 0 but items is empty", () => {
    const list = {
      items: [],
      total: 5,
      page: 1,
      pageSize: 10,
    } as unknown as Paginated<unknown>;
    expect(() => assertPaginated(list)).toThrow();
  });

  it("throws when items exceed pageSize", () => {
    const list = {
      items: [1, 2, 3, 4],
      total: 4,
      page: 1,
      pageSize: 3,
    } as unknown as Paginated<unknown>;
    expect(() => assertPaginated(list)).toThrow();
  });

  it("throws when total is negative", () => {
    const list = {
      items: [],
      total: -1,
      page: 1,
      pageSize: 10,
    } as unknown as Paginated<unknown>;
    expect(() => assertPaginated(list)).toThrow();
  });
});
