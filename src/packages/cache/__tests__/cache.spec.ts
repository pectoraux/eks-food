import { describe, it, expect } from "vitest";
import { InMemoryCache } from "../memory";
import { cacheAside, writeThrough } from "../patterns";

describe("InMemoryCache", () => {
  it("set/get round-trips", async () => {
    const c = new InMemoryCache();
    await c.set("k", "v");
    expect(await c.get("k")).toBe("v");
  });

  it("returns null on miss", async () => {
    const c = new InMemoryCache();
    expect(await c.get("missing")).toBeNull();
  });

  it("expires after TTL", async () => {
    const c = new InMemoryCache();
    await c.set("k", "v", { ttlMs: 10 });
    await new Promise((r) => setTimeout(r, 20));
    expect(await c.get("k")).toBeNull();
  });

  it("delete and deleteByPrefix", async () => {
    const c = new InMemoryCache();
    await c.set("user:1", "a");
    await c.set("user:2", "b");
    await c.set("other", "c");
    const removed = await c.deleteByPrefix("user:");
    expect(removed).toBe(2);
    expect(await c.get("user:1")).toBeNull();
    expect(await c.get("other")).toBe("c");
  });

  it("getOrSet is single-flight (stampede protection)", async () => {
    const c = new InMemoryCache();
    let calls = 0;
    const loader = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return "loaded"; };
    const [a, b] = await Promise.all([c.getOrSet("k", loader), c.getOrSet("k", loader)]);
    expect(a).toBe("loaded");
    expect(b).toBe("loaded");
    expect(calls).toBe(1);
  });

  it("acquireLock is exclusive", async () => {
    const c = new InMemoryCache();
    const lock1 = await c.acquireLock("resource", { retryCount: 1, retryDelayMs: 5 });
    expect(lock1.acquired).toBe(true);
    const lock2 = await c.acquireLock("resource", { retryCount: 1, retryDelayMs: 5 });
    expect(lock2.acquired).toBe(false);
    await lock1.release();
    const lock3 = await c.acquireLock("resource", { retryCount: 5, retryDelayMs: 5 });
    expect(lock3.acquired).toBe(true);
  });
});

describe("cacheAside pattern", () => {
  it("loads from source on miss and caches", async () => {
    const c = new InMemoryCache();
    let loads = 0;
    const loader = async () => { loads += 1; return 42; };
    expect(await cacheAside(c, "answer", loader)).toBe(42);
    expect(await cacheAside(c, "answer", loader)).toBe(42);
    expect(loads).toBe(1);
  });
});

describe("writeThrough pattern", () => {
  it("writes to source then refreshes cache", async () => {
    const c = new InMemoryCache();
    const store = new Map<string, number>();
    const writer = async () => { store.set("counter", 1); return "written"; };
    const readBack = async () => store.get("counter") ?? 0;
    await writeThrough(c, "counter", writer, readBack);
    expect(await c.get("counter")).toBe(1);
  });
});
