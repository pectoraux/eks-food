import { beforeEach, describe, expect, it } from "vitest";
import { mockRepository, type MockRepository } from "@eks/testing";

/**
 * Tenant-scoped store.
 *
 * Wraps a `mockRepository<T>` (the same fake repository used elsewhere
 * in the test suite) with strict organization-scoping semantics. This
 * models the production guarantee that an entity saved under tenant A
 * is NEVER visible to tenant B — neither via `find` nor `list`.
 *
 * The contract:
 *  - `save(orgId, entity)` stamps `orgId` onto the entity and persists
 *    it. It refuses to persist an entity whose `organizationId`
 *    already disagrees with `orgId` (defensive — a programming error
 *    that would silently corrupt tenant isolation).
 *  - `find(orgId, id)` returns the entity only if it exists AND its
 *    `organizationId` matches `orgId`; otherwise `null`.
 *  - `list(orgId)` returns only the entities whose `organizationId`
 *    matches `orgId`, in insertion order.
 *
 * `T` MUST carry `id` and `organizationId` — that's the structural
 * requirement for any tenant-scoped aggregate.
 */
interface TenantScopedEntity {
  readonly id: string;
  readonly organizationId: string;
}

class TenantScopedStore<T extends TenantScopedEntity> {
  private readonly backing: MockRepository<T> = mockRepository<T>();

  async save(orgId: string, entity: T): Promise<T> {
    if (entity.organizationId !== orgId) {
      throw new Error(
        `tenant isolation violation: entity.organizationId ` +
          `"${entity.organizationId}" != store orgId "${orgId}"`,
      );
    }
    return this.backing.save(entity);
  }

  async find(orgId: string, id: string): Promise<T | null> {
    const found = await this.backing.findById(id);
    if (found === null) return null;
    // Tenant isolation: an entity saved under a different org is
    // invisible — it's as if it doesn't exist.
    if (found.organizationId !== orgId) return null;
    return found;
  }

  async list(orgId: string): Promise<T[]> {
    const all = await this.backing.list();
    return all.filter((e) => e.organizationId === orgId);
  }

  /** Direct access for inspection in tests. */
  get raw(): MockRepository<T> {
    return this.backing;
  }
}

/** Sample tenant-scoped aggregate used in the tests below. */
interface TenantDocument {
  readonly id: string;
  readonly organizationId: string;
  readonly title: string;
  readonly content: string;
}

const ORG_A = "org-a-aaaaaaaa";
const ORG_B = "org-b-bbbbbbb";

describe("TenantScopedStore — multi-tenant isolation", () => {
  let store: TenantScopedStore<TenantDocument>;

  beforeEach(() => {
    store = new TenantScopedStore<TenantDocument>();
  });

  describe("save → find round-trip within the same tenant", () => {
    it("find(orgA, id) returns an entity saved under orgA", async () => {
      const doc: TenantDocument = {
        id: "doc-1",
        organizationId: ORG_A,
        title: "Menu Plan",
        content: "Jollof rice, kelewele, sobolo",
      };
      await store.save(ORG_A, doc);

      const found = await store.find(ORG_A, "doc-1");
      expect(found).not.toBeNull();
      expect(found?.id).toBe("doc-1");
      expect(found?.organizationId).toBe(ORG_A);
      expect(found?.title).toBe("Menu Plan");
      expect(found?.content).toBe("Jollof rice, kelewele, sobolo");
    });

    it("find returns null for an id that was never saved", async () => {
      const found = await store.find(ORG_A, "never-saved");
      expect(found).toBeNull();
    });
  });

  describe("(a) entity saved under orgA is NOT visible to orgB", () => {
    it("find(orgB, id) returns null when the entity was saved under orgA", async () => {
      const doc: TenantDocument = {
        id: "doc-secret",
        organizationId: ORG_A,
        title: "Confidential",
        content: "Payswap settlement report",
      };
      await store.save(ORG_A, doc);

      // Same id, wrong tenant → null.
      const leaked = await store.find(ORG_B, "doc-secret");
      expect(leaked).toBeNull();

      // And the right tenant still sees it.
      const ok = await store.find(ORG_A, "doc-secret");
      expect(ok?.id).toBe("doc-secret");
    });

    it("find under orgA returns null for an entity saved under orgB", async () => {
      const doc: TenantDocument = {
        id: "doc-b",
        organizationId: ORG_B,
        title: "Org B internal",
        content: "private",
      };
      await store.save(ORG_B, doc);

      expect(await store.find(ORG_A, "doc-b")).toBeNull();
      expect((await store.find(ORG_B, "doc-b"))?.id).toBe("doc-b");
    });
  });

  describe("(b) list(orgB) returns empty when only orgA has data", () => {
    it("list(orgB) is empty after saving multiple entities under orgA", async () => {
      await store.save(ORG_A, {
        id: "doc-a1",
        organizationId: ORG_A,
        title: "A1",
        content: "x",
      });
      await store.save(ORG_A, {
        id: "doc-a2",
        organizationId: ORG_A,
        title: "A2",
        content: "y",
      });
      await store.save(ORG_A, {
        id: "doc-a3",
        organizationId: ORG_A,
        title: "A3",
        content: "z",
      });

      const orgBList = await store.list(ORG_B);
      expect(orgBList).toEqual([]);

      const orgAList = await store.list(ORG_A);
      expect(orgAList.map((d) => d.id)).toEqual(["doc-a1", "doc-a2", "doc-a3"]);
    });

    it("list(orgA) stays empty until something is saved under orgA", async () => {
      expect(await store.list(ORG_A)).toEqual([]);
      expect(await store.list(ORG_B)).toEqual([]);

      await store.save(ORG_B, {
        id: "doc-b1",
        organizationId: ORG_B,
        title: "B1",
        content: "x",
      });

      // orgA is still empty after a write to orgB.
      expect(await store.list(ORG_A)).toEqual([]);
      expect(await store.list(ORG_B)).toHaveLength(1);
    });
  });

  describe("(c) find(orgB, entityFromOrgA.id) returns null", () => {
    it("cross-tenant find by id is blocked even when the id is known", async () => {
      const doc: TenantDocument = {
        id: "doc-cross-tenant",
        organizationId: ORG_A,
        title: "Should not leak",
        content: "secret",
      };
      await store.save(ORG_A, doc);

      // Even if orgB knows the exact id (e.g. via a leaked URL), the
      // store MUST NOT return it.
      const crossFind = await store.find(ORG_B, "doc-cross-tenant");
      expect(crossFind).toBeNull();
    });
  });

  describe("cross-tenant write prevention", () => {
    it("save refuses to persist an entity whose organizationId disagrees with the passed orgId", async () => {
      const malicious: TenantDocument = {
        id: "doc-evil",
        organizationId: ORG_B,
        title: "I want to live in orgA",
        content: "but I carry orgB's organizationId",
      };
      await expect(store.save(ORG_A, malicious)).rejects.toThrow(
        /tenant isolation violation/,
      );

      // Nothing was persisted.
      expect(await store.find(ORG_A, "doc-evil")).toBeNull();
      expect(await store.find(ORG_B, "doc-evil")).toBeNull();
      expect(await store.list(ORG_A)).toEqual([]);
      expect(await store.list(ORG_B)).toEqual([]);
    });
  });

  describe("multiple tenants coexist without leakage", () => {
    it("writes to orgA and orgB are isolated, and each tenant only sees its own entities", async () => {
      await store.save(ORG_A, {
        id: "doc-a-1",
        organizationId: ORG_A,
        title: "A1",
        content: "a1",
      });
      await store.save(ORG_B, {
        id: "doc-b-1",
        organizationId: ORG_B,
        title: "B1",
        content: "b1",
      });
      await store.save(ORG_A, {
        id: "doc-a-2",
        organizationId: ORG_A,
        title: "A2",
        content: "a2",
      });
      await store.save(ORG_B, {
        id: "doc-b-2",
        organizationId: ORG_B,
        title: "B2",
        content: "b2",
      });

      const a = await store.list(ORG_A);
      const b = await store.list(ORG_B);
      expect(a.map((d) => d.id)).toEqual(["doc-a-1", "doc-a-2"]);
      expect(b.map((d) => d.id)).toEqual(["doc-b-1", "doc-b-2"]);

      // Cross-tenant finds are blocked both directions.
      expect(await store.find(ORG_A, "doc-b-1")).toBeNull();
      expect(await store.find(ORG_B, "doc-a-2")).toBeNull();
    });

    it("a third tenant sees neither orgA nor orgB data", async () => {
      const ORG_C = "org-c-cccccccc";
      await store.save(ORG_A, {
        id: "doc-a",
        organizationId: ORG_A,
        title: "A",
        content: "a",
      });
      await store.save(ORG_B, {
        id: "doc-b",
        organizationId: ORG_B,
        title: "B",
        content: "b",
      });

      expect(await store.list(ORG_C)).toEqual([]);
      expect(await store.find(ORG_C, "doc-a")).toBeNull();
      expect(await store.find(ORG_C, "doc-b")).toBeNull();
    });
  });

  describe("returned entities are defensive copies (no reference leakage)", () => {
    it("mutating a returned entity does not affect the stored copy", async () => {
      const original: TenantDocument = {
        id: "doc-immut",
        organizationId: ORG_A,
        title: "Original",
        content: "original",
      };
      await store.save(ORG_A, original);

      const fetched = await store.find(ORG_A, "doc-immut");
      expect(fetched).not.toBeNull();
      if (fetched) {
        // Deliberately mutating a readonly field to confirm the store
        // returns a copy — the @ts-expect-error suppresses the
        // readonly-assignment error TS would otherwise raise.
        // @ts-expect-error — readonly field mutation, intentional.
        fetched.title = "HACKED";
      }

      const again = await store.find(ORG_A, "doc-immut");
      expect(again?.title).toBe("Original");
    });
  });

  describe("raw backing store", () => {
    it("exposes the underlying MockRepository for white-box assertions", async () => {
      await store.save(ORG_A, {
        id: "doc-raw",
        organizationId: ORG_A,
        title: "R",
        content: "r",
      });
      // The raw store sees every tenant — useful for cross-tenant
      // invariants in tests (e.g. asserting that a leaked write
      // never happened).
      expect(store.raw.store.size).toBe(1);
      expect(await store.raw.list()).toHaveLength(1);
    });
  });
});
