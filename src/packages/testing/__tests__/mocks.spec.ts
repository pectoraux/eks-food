import { beforeEach, describe, expect, it } from "vitest";
import { mockRepository, type MockRepository } from "../mocks";

interface TestCook {
  id: string;
  name: string;
  rating: number;
}

describe("mockRepository", () => {
  let repo: MockRepository<TestCook>;

  beforeEach(() => {
    repo = mockRepository<TestCook>();
  });

  it("returns null for an unknown id", async () => {
    await expect(repo.findById("nope")).resolves.toBeNull();
  });

  it("returns an empty list when nothing has been saved", async () => {
    await expect(repo.list()).resolves.toEqual([]);
  });

  it("round-trips save -> findById", async () => {
    const saved = await repo.save({
      id: "cook_1",
      name: "Amara",
      rating: 4.8,
    });
    expect(saved).toEqual({ id: "cook_1", name: "Amara", rating: 4.8 });

    const found = await repo.findById("cook_1");
    expect(found).toEqual({ id: "cook_1", name: "Amara", rating: 4.8 });
  });

  it("save overwrites on duplicate id", async () => {
    await repo.save({ id: "cook_1", name: "Amara", rating: 4.8 });
    await repo.save({ id: "cook_1", name: "Amara Mensah", rating: 4.9 });

    const found = await repo.findById("cook_1");
    expect(found).toEqual({ id: "cook_1", name: "Amara Mensah", rating: 4.9 });
    await expect(repo.list()).resolves.toHaveLength(1);
  });

  it("list returns every saved entity in insertion order", async () => {
    await repo.save({ id: "cook_1", name: "Amara", rating: 4.8 });
    await repo.save({ id: "cook_2", name: "Kwame", rating: 4.6 });
    await repo.save({ id: "cook_3", name: "Zainab", rating: 4.9 });

    const all = await repo.list();
    expect(all.map((c) => c.id)).toEqual(["cook_1", "cook_2", "cook_3"]);
  });

  it("does not let callers mutate stored state via the returned entity", async () => {
    await repo.save({ id: "cook_1", name: "Amara", rating: 4.8 });
    const first = await repo.findById("cook_1");
    if (first) first.rating = 1.0; // mutate the returned object

    const second = await repo.findById("cook_1");
    expect(second?.rating).toBe(4.8); // stored value untouched
  });

  it("does not let callers mutate stored state via list()", async () => {
    await repo.save({ id: "cook_1", name: "Amara", rating: 4.8 });
    const all = await repo.list();
    all[0].name = "HACKED";

    const found = await repo.findById("cook_1");
    expect(found?.name).toBe("Amara");
  });

  it("reset() empties the store", async () => {
    await repo.save({ id: "cook_1", name: "Amara", rating: 4.8 });
    expect(repo.store.size).toBe(1);
    repo.reset();
    expect(repo.store.size).toBe(0);
    await expect(repo.list()).resolves.toEqual([]);
    await expect(repo.findById("cook_1")).resolves.toBeNull();
  });

  it("exposes the backing Map for direct setup", async () => {
    repo.store.set("cook_99", { id: "cook_99", name: "Direct", rating: 5.0 });
    const found = await repo.findById("cook_99");
    expect(found).toEqual({ id: "cook_99", name: "Direct", rating: 5.0 });
  });
});
