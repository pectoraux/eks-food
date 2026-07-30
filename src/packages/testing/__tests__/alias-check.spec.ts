import { describe, expect, it } from "vitest";
// Smoke test: verifies the `@eks/*` path alias resolves through the
// `@eks/testing` barrel and that the barrel re-exports every utility the
// testing foundation promises (factories, fixtures, assertions, mocks,
// http, types).
import {
  assertDomainError,
  assertErr,
  assertOk,
  assertPaginated,
  buildNextRequest,
  err,
  factory,
  makeEmailAddress,
  makeGeoPoint,
  makeISODate,
  makeMoney,
  makeResult,
  makeUuid,
  mockRepository,
  ok,
  SAMPLE_DOMAIN_ERROR,
  TEST_ORG_ID,
  TEST_USER_ID,
} from "@eks/testing";

describe("@eks/testing barrel + path alias", () => {
  it("re-exports the factory helpers", () => {
    expect(makeUuid("seed")).toBe(makeUuid("seed"));
    expect(makeMoney({ amount: 5 }).amount).toBe(5);
    expect(makeGeoPoint()).toEqual({ lat: 5.6037, lng: -0.187 });
    expect(makeEmailAddress("amara")).toBe("amara@example.com");
    expect(makeISODate()).toBe("2024-01-01T00:00:00.000Z");
    expect(makeResult(2)).toEqual({ ok: true, value: 2 });
    expect(factory({ a: 1 })()).toEqual({ a: 1 });
  });

  it("re-exports the fixtures", () => {
    expect(TEST_ORG_ID).toMatch(/^00000000-/);
    expect(TEST_USER_ID).toMatch(/^00000000-/);
    expect(SAMPLE_DOMAIN_ERROR.code).toBe("BOOKING_NOT_FOUND");
  });

  it("re-exports the assertion helpers", () => {
    const good = ok("hi");
    assertOk(good);
    const bad = err(SAMPLE_DOMAIN_ERROR);
    assertErr(bad);
    assertDomainError(bad, "BOOKING_NOT_FOUND");
    assertPaginated({ items: [1], total: 1, page: 1, pageSize: 10 });
  });

  it("re-exports the mock repository builder", () => {
    const repo = mockRepository<{ id: string; n: number }>();
    expect(repo.store.size).toBe(0);
    repo.reset();
  });

  it("re-exports the http helper", () => {
    const req = buildNextRequest("http://localhost/api/cooks", {
      method: "POST",
      body: { q: 1 },
    });
    expect(req.method).toBe("POST");
  });
});
