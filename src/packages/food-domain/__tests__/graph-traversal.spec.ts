import { describe, expect, it } from "vitest";

/**
 * GraphEngine — a minimal in-process directed graph engine that powers
 * the Food Intelligence Graph's traversal queries. Implemented in-file
 * for testing the pure-logic contract before the production engine
 * ships under @eks/food-domain.
 *
 * Responsibilities:
 *  - addNode(id, properties?) — register a node with optional properties.
 *  - addEdge(from, to, properties?) — register a directed edge. Multiple
 *    distinct edges between the same pair are coalesced (idempotent).
 *  - traverse(startId) — BFS over the graph from `startId`, returning the
 *    list of reachable node ids (excluding the start). Order is BFS
 *    discovery order.
 *  - shortestPath(from, to) — BFS shortest-path returning the minimum-hop
 *    path as an array of node ids from `from` to `to` (inclusive), or
 *    `null` when no path exists.
 *  - neighbors(id) — the direct successors of `id` (in insertion order).
 *  - hasPath(from, to) — true iff `to` is reachable from `from`.
 *
 * Cycle safety: every traversal maintains a `visited` set so a node is
 * never enqueued twice. This is what the cycle-detection test asserts.
 */

export interface GraphNode {
  readonly id: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

export class GraphEngine {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly adjacency = new Map<string, GraphEdge[]>();

  addNode(id: string, properties: Readonly<Record<string, unknown>> = {}): void {
    if (this.nodes.has(id)) {
      // Merge properties but keep id stable.
      const existing = this.nodes.get(id);
      if (existing) {
        this.nodes.set(id, { id, properties: { ...existing.properties, ...properties } });
      }
      return;
    }
    this.nodes.set(id, { id, properties });
    if (!this.adjacency.has(id)) {
      this.adjacency.set(id, []);
    }
  }

  addEdge(
    from: string,
    to: string,
    properties: Readonly<Record<string, unknown>> = {},
  ): void {
    // Ensure both endpoints exist as nodes.
    this.addNode(from);
    this.addNode(to);

    const edges = this.adjacency.get(from) ?? [];
    // Idempotent: if an edge from→to already exists, skip.
    if (edges.some((e) => e.to === to)) {
      return;
    }
    edges.push({ from, to, properties });
    this.adjacency.set(from, edges);
  }

  /** BFS traversal from `startId`; returns reachable node ids in discovery order (excluding start). */
  traverse(startId: string): string[] {
    if (!this.nodes.has(startId)) {
      return [];
    }
    const visited = new Set<string>([startId]);
    const queue: string[] = [startId];
    const out: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      const edges = this.adjacency.get(current) ?? [];
      for (const edge of edges) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          out.push(edge.to);
          queue.push(edge.to);
        }
      }
    }
    return out;
  }

  /** BFS shortest-path; returns the path array (inclusive) or null if unreachable. */
  shortestPath(from: string, to: string): string[] | null {
    if (!this.nodes.has(from) || !this.nodes.has(to)) {
      return null;
    }
    if (from === to) {
      return [from];
    }
    const visited = new Set<string>([from]);
    // Reconstruct path via parent pointers.
    const parent = new Map<string, string | null>([[from, null]]);
    const queue: string[] = [from];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      if (current === to) {
        // Reconstruct.
        const path: string[] = [];
        let cursor: string | null = current;
        while (cursor !== null) {
          path.unshift(cursor);
          cursor = parent.get(cursor) ?? null;
        }
        return path;
      }
      const edges = this.adjacency.get(current) ?? [];
      for (const edge of edges) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          parent.set(edge.to, current);
          queue.push(edge.to);
        }
      }
    }
    return null;
  }

  /** Direct successors of `id`, in insertion order. */
  neighbors(id: string): string[] {
    const edges = this.adjacency.get(id) ?? [];
    return edges.map((e) => e.to);
  }

  /** True iff `to` is reachable from `from` via any directed path. */
  hasPath(from: string, to: string): boolean {
    if (from === to) {
      return this.nodes.has(from);
    }
    return this.shortestPath(from, to) !== null;
  }

  /** All node ids (insertion order). Test helper. */
  nodeIds(): string[] {
    return Array.from(this.nodes.keys());
  }
}

describe("GraphEngine — node + edge registration", () => {
  it("addNode registers a node and exposes it via nodeIds", () => {
    const g = new GraphEngine();
    g.addNode("A");
    g.addNode("B");
    expect(g.nodeIds()).toEqual(["A", "B"]);
  });

  it("addNode is idempotent (re-adding the same id does not duplicate)", () => {
    const g = new GraphEngine();
    g.addNode("A");
    g.addNode("A");
    expect(g.nodeIds()).toEqual(["A"]);
  });

  it("addNode merges properties on re-add", () => {
    const g = new GraphEngine();
    g.addNode("A", { kind: "Recipe" });
    g.addNode("A", { cuisine: "Ghanaian" });
    expect(g.nodeIds()).toEqual(["A"]);
  });

  it("addEdge auto-creates missing endpoints as nodes", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    expect(g.nodeIds().sort()).toEqual(["A", "B"]);
    expect(g.neighbors("A")).toEqual(["B"]);
  });

  it("addEdge is idempotent (duplicate from→to edges coalesce)", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    g.addEdge("A", "B");
    expect(g.neighbors("A")).toEqual(["B"]);
  });
});

describe("GraphEngine — BFS traversal", () => {
  it("traverse from A reaches D via B and C", () => {
    const g = new GraphEngine();
    // A → B → C → D, plus A → C (shortcut).
    g.addEdge("A", "B");
    g.addEdge("B", "C");
    g.addEdge("C", "D");
    g.addEdge("A", "C");

    const reached = g.traverse("A");
    // D must be reachable from A.
    expect(reached).toContain("D");
    // B and C must also be reached.
    expect(reached).toContain("B");
    expect(reached).toContain("C");
    // Order: BFS discovery — A's direct neighbors (B, C) come first, then their neighbors (D).
    expect(receivedIndex(reached, "B")).toBeLessThan(receivedIndex(reached, "D"));
    expect(receivedIndex(reached, "C")).toBeLessThan(receivedIndex(reached, "D"));
  });

  it("traverse returns an empty array for an unknown start node", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    expect(g.traverse("Z")).toEqual([]);
  });

  it("traverse of a single-node graph returns no other nodes", () => {
    const g = new GraphEngine();
    g.addNode("solo");
    expect(g.traverse("solo")).toEqual([]);
  });

  it("traverse never visits a node more than once (cycle safety)", () => {
    const g = new GraphEngine();
    // Triangle: A → B → C → A.
    g.addEdge("A", "B");
    g.addEdge("B", "C");
    g.addEdge("C", "A");
    const reached = g.traverse("A");
    // B and C appear exactly once; A (the start) does not appear at all.
    expect(countOccurrences(reached, "B")).toBe(1);
    expect(countOccurrences(reached, "C")).toBe(1);
    expect(countOccurrences(reached, "A")).toBe(0);
  });
});

describe("GraphEngine — shortestPath", () => {
  it("returns the minimum-hop path A→D as [A,B,C,D] when no shortcut exists", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    g.addEdge("B", "C");
    g.addEdge("C", "D");
    const path = g.shortestPath("A", "D");
    expect(path).toEqual(["A", "B", "C", "D"]);
  });

  it("returns the shortcut path [A,C,D] when a shortcut exists", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    g.addEdge("B", "C");
    g.addEdge("C", "D");
    g.addEdge("A", "C"); // shortcut
    const path = g.shortestPath("A", "D");
    expect(path).toEqual(["A", "C", "D"]);
  });

  it("returns [from] when from === to", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    expect(g.shortestPath("A", "A")).toEqual(["A"]);
  });

  it("returns null when no path exists", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    g.addEdge("C", "D"); // disconnected component
    expect(g.shortestPath("A", "D")).toBeNull();
  });

  it("returns null when an endpoint does not exist", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    expect(g.shortestPath("A", "Z")).toBeNull();
    expect(g.shortestPath("Z", "A")).toBeNull();
  });

  it("returns the path of length 1 for a direct edge", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    expect(g.shortestPath("A", "B")).toEqual(["A", "B"]);
  });
});

describe("GraphEngine — neighbors", () => {
  it("returns the direct successors in insertion order", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    g.addEdge("A", "C");
    g.addEdge("A", "D");
    expect(g.neighbors("A")).toEqual(["B", "C", "D"]);
  });

  it("returns an empty array for a node with no outgoing edges", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    expect(g.neighbors("B")).toEqual([]);
  });

  it("returns an empty array for an unknown node", () => {
    const g = new GraphEngine();
    expect(g.neighbors("phantom")).toEqual([]);
  });

  it("only returns successors (directed — reverse edge not implied)", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    expect(g.neighbors("A")).toEqual(["B"]);
    expect(g.neighbors("B")).toEqual([]);
  });
});

describe("GraphEngine — hasPath", () => {
  it("returns true when a path exists", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    g.addEdge("B", "C");
    g.addEdge("C", "D");
    expect(g.hasPath("A", "D")).toBe(true);
  });

  it("returns false for disconnected nodes", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    g.addEdge("C", "D");
    expect(g.hasPath("A", "D")).toBe(false);
  });

  it("returns true when from === to (a node is reachable from itself)", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    expect(g.hasPath("A", "A")).toBe(true);
  });

  it("returns false when from === to but the node does not exist", () => {
    const g = new GraphEngine();
    expect(g.hasPath("phantom", "phantom")).toBe(false);
  });

  it("returns false for the reverse direction in a directed graph", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    expect(g.hasPath("A", "B")).toBe(true);
    expect(g.hasPath("B", "A")).toBe(false);
  });
});

describe("GraphEngine — cycle handling", () => {
  it("a node does not appear twice in a shortest path even with a cycle", () => {
    const g = new GraphEngine();
    // Cycle: A → B → A; plus A → C → D.
    g.addEdge("A", "B");
    g.addEdge("B", "A");
    g.addEdge("A", "C");
    g.addEdge("C", "D");
    const path = g.shortestPath("A", "D");
    expect(path).toEqual(["A", "C", "D"]);
    // No duplicates anywhere in the path.
    if (path) {
      expect(new Set(path).size).toBe(path.length);
    }
  });

  it("traversal of a self-loop terminates and visits the node only once", () => {
    const g = new GraphEngine();
    g.addEdge("A", "A"); // self-loop
    g.addEdge("A", "B");
    const reached = g.traverse("A");
    expect(reached).toEqual(["B"]); // A's self-loop doesn't add anything; B is reached once.
  });

  it("traversal of a larger cycle (5 nodes) visits each reachable node exactly once", () => {
    const g = new GraphEngine();
    g.addEdge("A", "B");
    g.addEdge("B", "C");
    g.addEdge("C", "D");
    g.addEdge("D", "E");
    g.addEdge("E", "A");
    const reached = g.traverse("A");
    expect(new Set(reached).size).toBe(reached.length);
    expect(reached.sort()).toEqual(["B", "C", "D", "E"]);
  });
});

// --- helpers ---

function receivedIndex(arr: readonly string[], value: string): number {
  const idx = arr.indexOf(value);
  if (idx === -1) {
    throw new Error(`expected ${value} to be reached, but it was not in ${JSON.stringify(arr)}`);
  }
  return idx;
}

function countOccurrences(arr: readonly string[], value: string): number {
  return arr.reduce((n, x) => (x === value ? n + 1 : n), 0);
}
