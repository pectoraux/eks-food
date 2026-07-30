# Eks-Food Food Intelligence Graph — Query Guide

> **Audience:** Application engineers, AI/recommendation engineers, analytics engineers. Read alongside `GRAPH_ARCHITECTURE.md` (engine internals, performance characteristics), `ENTITY_RELATIONSHIPS.md` (edge vocabulary), `API_DOCUMENTATION.md` §11 (REST graph routes), `OPERATIONAL_RUNBOOKS.md` §3 (latency SLOs).
>
> **Status:** Milestone 6. This document is a cookbook of `GraphEngine` usage patterns in TypeScript. Every example is runnable against the `@eks/food-domain` package's `PostgresGraphEngine` implementation.

---

## 1. Setup

### 1.1 Install
`@eks/food-domain` is the public package. It re-exports the `GraphEngine` interface, the `PostgresGraphEngine` implementation, the edge-type vocabulary, and the Zod schemas.

```typescript
import {
  GraphEngine,
  PostgresGraphEngine,
  EDGE_TYPES,
  NodeRef,
  GraphClient,
} from '@eks/food-domain';
```

### 1.2 Construction
The `GraphEngine` is constructed once per process and injected via DI (see `docs/developer/ARCHITECTURE.md` for the DI container pattern). The `PostgresGraphEngine` takes a Prisma client and a tenant context factory:

```typescript
import { PrismaClient } from '@prisma/client';
import { PostgresGraphEngine } from '@eks/food-domain';

const prisma = new PrismaClient();
const engine: GraphEngine = new PostgresGraphEngine({
  prisma,
  // Tenant context is resolved per-request from the authenticated session.
  tenantContextFactory: (req) => ({ organizationId: req.user.organizationId }),
  // Hard ceiling on traversal depth; default 6.
  maxTraversalDepth: 6,
  // Default result limit; default 10_000 nodes.
  defaultResultLimit: 10_000,
});
```

### 1.3 The `GraphClient` helper
For application code, the `GraphClient` wrapper provides a tenant-scoped facade:

```typescript
import { GraphClient } from '@eks/food-domain';

const graph = new GraphClient(engine, { organizationId: 'org-123' });

// All calls on `graph` are automatically scoped to org-123.
const cook = await graph.getNode('CookProfile', '550e...');
```

All examples below use the `GraphClient` facade.

---

## 2. Reading Nodes & Edges

### 2.1 Get a single node
```typescript
const node = await graph.getNode('CookProfile', '550e8400-e29b-41d4-a716-446655440000');
if (!node) {
  console.log('Cook not found or not in this tenant.');
  return;
}
console.log(node.label);        // "Amara Boateng"
console.log(node.properties);   // { cuisines: ['west-african'], state: 'ACTIVE', ... }
console.log(node.tags);         // ['verified', 'ghana']
console.log(node.degreeIn);     // 42
console.log(node.degreeOut);    // 7
```

### 2.2 Get an edge
```typescript
const edge = await graph.getEdge('relationship-uuid-...');
console.log(edge.type);         // "works_at"
console.log(edge.properties);   // { role: 'head-chef', startDate: '...' }
```

### 2.3 Node degree
```typescript
const inDegree  = await graph.degree({ entityType: 'CookProfile', entityId: cookId }, 'in');
const outDegree = await graph.degree({ entityType: 'CookProfile', entityId: cookId }, 'out');
const total     = await graph.degree({ entityType: 'CookProfile', entityId: cookId }, 'both');
```

### 2.4 Count edges matching a filter
```typescript
const activeWorksAt = await graph.countEdges({
  type: 'works_at',
  state: 'ACTIVE',
  fromType: 'CookProfile',
});
```

---

## 3. BFS Traversal

### 3.1 Find all ingredients in a recipe (1-hop)
```typescript
const result = await graph.traverse({
  start: { entityType: 'Recipe', entityId: jollofRecipeId },
  direction: 'outbound',
  edgeTypes: ['contains'],
  maxDepth: 1,
  return: 'nodes',
});

for (const node of result.nodes) {
  console.log(node.entityType, node.label);  // Ingredient Tomato
}
```

### 3.2 Find every kitchen a cook has access to, and the equipment in those kitchens (2-hop)
```typescript
const result = await graph.traverse({
  start: { entityType: 'CookProfile', entityId: cookId },
  direction: 'outbound',
  edgeTypes: ['works_at', 'contains'],
  maxDepth: 2,
  return: 'paths',
  nodeFilter: (node, depth) => depth === 2 ? node.entityType === 'Equipment' : true,
});

for (const path of result.paths) {
  // path: [cookNode, kitchenNode, equipmentNode]
  console.log(`Cook ${path[0].label} works at ${path[1].label} which has ${path[2].label}`);
}
```

### 3.3 Find all menu items offered by any restaurant a cook works at (3-hop)
```typescript
const result = await graph.traverse({
  start: { entityType: 'CookProfile', entityId: cookId },
  direction: 'outbound',
  edgeTypes: ['works_at', 'operated_by', 'contains'],
  // Note: 'operated_by' is the reverse of 'operates'. direction='outbound'
  // traverses from Kitchen to Restaurant via 'operated_by'.
  maxDepth: 3,
  return: 'nodes',
  uniqueNodes: true,
});

// Result: every menu item the cook can influence via their kitchens.
```

### 3.4 Limiting result size
```typescript
const result = await graph.traverse({
  start: { entityType: 'Ingredient', entityId: tomatoId },
  direction: 'inbound',
  edgeTypes: ['contains', 'featured_in', 'derived_from'],
  maxDepth: 3,
  return: 'nodes',
  limit: 500,
});

if (result.truncated) {
  console.warn('Result truncated; use cursor pagination for full set.');
  console.log('Next cursor:', result.nextCursor);
}
```

### 3.5 Cursor pagination
```typescript
let cursor: string | undefined;
const allNodes: GraphNode[] = [];
do {
  const result = await graph.traverse({
    start: { entityType: 'Ingredient', entityId: tomatoId },
    direction: 'inbound',
    edgeTypes: ['contains'],
    maxDepth: 3,
    return: 'nodes',
    limit: 1000,
    cursor,
  });
  allNodes.push(...result.nodes);
  cursor = result.nextCursor;
} while (cursor);

console.log(`Total: ${allNodes.length} recipes use tomato.`);
```

---

## 4. Shortest-Path Queries

### 4.1 Unweighted (minimum hops)
"What's the supply chain path from this ingredient to this cook?"

```typescript
const path = await graph.shortestPath({
  from: { entityType: 'Ingredient', entityId: tomatoId },
  to:   { entityType: 'CookProfile', entityId: cookId },
  edgeTypes: ['supplied_by', 'supplies_to', 'works_at'],
  // 'supplied_by' is the reverse of 'supplies' (Ingredient ← Supplier).
  // 'supplies_to' is Supplier → Kitchen.
  // 'works_at' is CookProfile → Kitchen.
  // The engine traverses direction='any' by default for shortest-path.
  weighted: false,
  maxDepth: 5,
});

if (!path) {
  console.log('No path within 5 hops.');
} else {
  console.log(`Path length: ${path.length} hops`);
  for (const node of path.path) {
    console.log(`  ${node.entityType}: ${node.label}`);
  }
  // Ingredient: Tomato
  //   → Supplier: Accra Fresh Produce
  //     → Kitchen: Ama's Kitchen
  //       → CookProfile: Amara Boateng
}
```

### 4.2 Weighted (Dijkstra)
"Find the supply chain path with the lowest total cost (sum of `weight`)."

Edges carry a `weight` column. For `supplies_to` edges, the projection worker sets `weight` to the supplier's `leadTimeDays` (or `1` if unset); for `supplies` edges, `weight` is `1`; for `works_at` edges, `weight` is `1`.

```typescript
const path = await graph.shortestPath({
  from: { entityType: 'Ingredient', entityId: tomatoId },
  to:   { entityType: 'CookProfile', entityId: cookId },
  edgeTypes: ['supplied_by', 'supplies_to', 'works_at'],
  weighted: true,            // use Dijkstra
  maxDepth: 5,
});

console.log(`Total cost: ${path.totalWeight}`);  // e.g. 4.5 (sum of lead times)
```

### 4.3 Bidirectional BFS for unweighted paths
The `PostgresGraphEngine` uses bidirectional BFS for unweighted shortest-path queries — it expands from both ends simultaneously and terminates when the frontiers meet. This is significantly faster than unidirectional BFS for paths of length ≥ 4. The algorithm is transparent to the caller; you don't choose it.

---

## 5. Neighborhood Analysis

### 5.1 1-hop neighborhood
"Who does this cook work with?"

```typescript
const result = await graph.neighborhood({
  center: { entityType: 'CookProfile', entityId: cookId },
  radius: 1,
  direction: 'any',
});

for (const m of result.members) {
  console.log(`${m.node.entityType} ${m.node.label} (via ${m.viaEdgeType})`);
}
// Kitchen Ama's Kitchen (via works_at)
// CustomerProfile Kwame Mensah (via follows, inbound)
// Certification Food Safety L2 (via certified_by)
```

### 5.2 2-hop neighborhood with type filter
"What ingredients can this cook access via their kitchen's inventory?"

```typescript
const result = await graph.neighborhood({
  center: { entityType: 'CookProfile', entityId: cookId },
  radius: 2,
  edgeTypes: ['works_at', 'stocked_at', 'stocks', 'contains'],
  direction: 'outbound',
  nodeTypes: ['Ingredient'],
});

console.log(`Cook has access to ${result.members.length} distinct ingredients.`);
console.log(`Stats:`, result.stats);
// { totalNodes: 87, totalEdges: 142, byDistance: { 1: 1, 2: 86 } }
```

### 5.3 3-hop dependency neighborhood
"What depends on this ingredient?"

```typescript
const result = await graph.neighborhood({
  center: { entityType: 'Ingredient', entityId: tomatoId },
  radius: 3,
  edgeTypes: ['contains', 'featured_in', 'derived_from', 'contains'],  // Menu contains MenuItem
  direction: 'inbound',
});

// 1-hop inbound: Recipes that contain Tomato
// 2-hop inbound: MenuItems derived from those Recipes
// 3-hop inbound: Menus that contain those MenuItems
for (const m of result.members) {
  console.log(`[${m.distance}] ${m.node.entityType}: ${m.node.label}`);
}
```

### 5.4 Stats aggregation
```typescript
const result = await graph.neighborhood({ /* ... */ });
console.log(result.stats);
// {
//   totalNodes: 245,
//   totalEdges: 312,
//   byDistance: { 1: 12, 2: 87, 3: 146 },
//   byEdgeType: { contains: 87, featured_in: 56, derived_from: 56, member_of: 113 }
// }
```

---

## 6. Subgraph Extraction

### 6.1 Extract a subgraph for visualization
```typescript
const subgraph = await graph.subgraph({
  start: { entityType: 'CookProfile', entityId: cookId },
  edgeTypes: ['works_at', 'contains', 'stocked_at', 'stocks'],
  maxDepth: 3,
  nodeTypes: ['CookProfile', 'Kitchen', 'Equipment', 'Inventory', 'InventoryBatch'],
});

// subgraph.nodes: GraphNode[]
// subgraph.edges: GraphEdge[]
// Serialize to D3-compatible JSON for the frontend:
res.json({
  nodes: subgraph.nodes.map(n => ({ id: n.id, label: n.label, type: n.entityType })),
  links: subgraph.edges.map(e => ({ source: e.fromNodeId, target: e.toNodeId, type: e.type })),
});
```

### 6.2 Extract for ML feature engineering
```typescript
const subgraph = await graph.subgraph({
  start: { entityType: 'CustomerProfile', entityId: customerId },
  edgeTypes: ['follows', 'books', 'contains', 'authored_by'],
  maxDepth: 3,
});

// Materialize as a node-feature matrix for the recommender:
const features = subgraph.nodes.map(n => ({
  nodeId: n.id,
  entityType: n.entityType,
  tags: n.tags,
  cuisines: n.properties.cuisines ?? [],
}));
```

---

## 7. Dependency Analysis

### 7.1 What depends on this ingredient?
A common ops question: "If we recall tomato, what's affected?"

```typescript
async function impactAnalysis(ingredientId: string) {
  const result = await graph.traverse({
    start: { entityType: 'Ingredient', entityId: ingredientId },
    direction: 'inbound',
    edgeTypes: ['contains', 'featured_in', 'derived_from', 'contains'],
    maxDepth: 4,
    return: 'subgraph',
  });

  // Categorize by entity type:
  const byType: Record<string, number> = {};
  for (const n of result.nodes) {
    byType[n.entityType] = (byType[n.entityType] ?? 0) + 1;
  }

  return {
    totalAffected: result.nodes.length,
    recipes:       byType['Recipe']       ?? 0,
    menuItems:     byType['MenuItem']     ?? 0,
    menus:         byType['Menu']         ?? 0,
    kitchens:      byType['Kitchen']      ?? 0,  // via produces → MenuItem
    inventoryBatches: byType['InventoryBatch'] ?? 0,
  };
}

const impact = await impactAnalysis(tomatoId);
console.log(impact);
// { totalAffected: 142, recipes: 38, menuItems: 24, menus: 12, kitchens: 8, inventoryBatches: 60 }
```

### 7.2 What does this recipe depend on?
```typescript
const result = await graph.traverse({
  start: { entityType: 'Recipe', entityId: recipeId },
  direction: 'outbound',
  edgeTypes: ['contains'],
  maxDepth: 1,
  return: 'nodes',
});

const ingredientIds = result.nodes.map(n => n.entityId);

// Now check inventory availability across all kitchens that produce this recipe:
const kitchens = await graph.traverse({
  start: { entityType: 'Recipe', entityId: recipeId },
  direction: 'inbound',
  edgeTypes: ['featured_in', 'produced_at'],
  maxDepth: 2,
  return: 'nodes',
  nodeFilter: (n) => n.entityType === 'Kitchen',
});
```

### 7.3 Cycle detection in substitution graph
```typescript
import { CycleDetector } from '@eks/food-domain';

const detector = new CycleDetector(graph);
const cycle = await detector.findCycle({
  entityType: 'Ingredient',
  entityId: tomatoId,
  edgeTypes: ['substitutes'],
});

if (cycle) {
  console.warn('Substitution cycle detected:', cycle);
  // Reject the proposed substitute edge at the application layer.
}
```

---

## 8. Temporal Queries

### 8.1 As-of traversal
"What did this cook's supply chain look like on June 1, 2024?"

```typescript
const result = await graph.traverseAsOf({
  start: { entityType: 'CookProfile', entityId: cookId },
  direction: 'outbound',
  edgeTypes: ['works_at', 'stocked_at', 'stocks', 'contains'],
  maxDepth: 3,
  return: 'subgraph',
}, '2024-06-01T00:00:00Z');

// Returns only edges where validFrom <= 2024-06-01 AND
// (validUntil IS NULL OR validUntil > 2024-06-01).
```

### 8.2 Comparing neighborhoods over time
```typescript
const jun = await graph.traverseAsOf({ /* ... */ }, '2024-06-01T00:00:00Z');
const dec = await graph.traverseAsOf({ /* ... */ }, '2024-12-01T00:00:00Z');

const junSet = new Set(jun.nodes.map(n => n.id));
const decSet = new Set(dec.nodes.map(n => n.id));

const added   = [...decSet].filter(id => !junSet.has(id));
const removed = [...junSet].filter(id => !decSet.has(id));

console.log(`Ingredients added between Jun and Dec: ${added.length}`);
console.log(`Ingredients removed: ${removed.length}`);
```

### 8.3 Edge history
```typescript
// Get every version of a specific relationship (including superseded):
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const history = await prisma.relationship.findMany({
  where: {
    OR: [
      { id: relId },
      { supersededById: relId },
    ],
  },
  orderBy: { validFrom: 'asc' },
});
```

---

## 9. Graph Snapshots

### 9.1 Create a snapshot
```typescript
const ref = await graph.createSnapshot({
  scope: {
    organizationId: 'org-123',
    entityTypes: ['CookProfile', 'Kitchen', 'Recipe', 'Ingredient'],
    edgeTypes: ['works_at', 'contains', 'authored_by'],
  },
});

console.log(ref.snapshotId);     // UUID
console.log(ref.nodeCount);      // 12_345
console.log(ref.edgeCount);      // 45_678
console.log(ref.contentHash);    // sha256:...
console.log(ref.storageKey);     // s3://eks-food-graph-snapshots/org-123/2024/...
```

### 9.2 Load a snapshot
```typescript
const snapshot = await graph.loadSnapshot(ref);

// Iterate the snapshot as a stream:
for await (const batch of snapshot.nodesStream(1000)) {
  for (const node of batch) {
    // process node
  }
}
```

### 9.3 Compare two snapshots
```typescript
import { SnapshotDiffer } from '@eks/food-domain';

const differ = new SnapshotDiffer();
const diff = await differ.compare(prevSnapshotRef, currSnapshotRef);

console.log(diff.summary);
// { addedNodes: 23, removedNodes: 5, updatedNodes: 18, addedEdges: 41, removedEdges: 12 }
```

### 9.4 Restore from snapshot
Restoring from a snapshot is an admin-only operation (`food-domain.graph.restore-snapshot` permission). It re-applies the snapshot's edges to the live graph (creating new `Relationship` rows and superseding existing ones as needed). The operation is idempotent and emits a `food-domain.graph.snapshot.restored.v1` event.

```typescript
await graph.restoreFromSnapshot(ref, {
  mode: 'replace',     // 'replace' or 'merge'
  dryRun: false,
});
```

---

## 10. Writing Edges (Domain Services)

Application code rarely writes to `Relationship` directly. Instead, it uses domain service methods that handle edge creation as a side effect:

```typescript
// Adding a cook to a kitchen creates a 'works_at' Relationship:
await cookService.assignKitchen({
  cookProfileId: cookId,
  kitchenId,
  role: 'head-chef',
  startDate: new Date(),
});
// Internally:
//   1. Validates both entities exist and are in the same tenant.
//   2. Checks for an existing ACTIVE 'works_at' edge between them.
//      - If exists: updates properties (in-place, new version).
//      - If not: creates a new Relationship.
//   3. Emits 'food-domain.relationship.created.v1' (or .updated.v1).
//   4. Writes EntityVersion + AuditLog.
//   5. The GraphProjectionWorker updates GraphNode/GraphEdge async.
```

For edge types without a convenience service (e.g. `partner_of`, `substitutes`), use the `RelationshipService`:

```typescript
import { RelationshipService } from '@eks/food-domain';

const relService = new RelationshipService(/* ... */);

await relService.create({
  fromType: 'Vendor',
  fromId: vendorId,
  toType: 'Restaurant',
  toId: restaurantId,
  type: 'partner_of',
  properties: { contractId: 'P-2024-001', startDate: '2024-06-01' },
  validFrom: '2024-06-01T00:00:00Z',
});

// Supersede an old edge:
await relService.supersede(oldRelId, {
  newProperties: { contractId: 'P-2025-001', startDate: '2025-01-01' },
  validFrom: '2025-01-01T00:00:00Z',
});
```

---

## 11. Performance Tuning

### 11.1 Always scope by `edgeTypes`
The most impactful optimization is to pass `edgeTypes` on every `traverse` call. Without it, the engine considers every edge type and the result set explodes combinatorially.

```typescript
// ❌ Don't:
await graph.traverse({ start: cookRef, maxDepth: 3, direction: 'any' });

// ✅ Do:
await graph.traverse({
  start: cookRef,
  maxDepth: 3,
  direction: 'outbound',
  edgeTypes: ['works_at', 'contains', 'produces'],
});
```

### 11.2 Use `nodeFilter` to prune early
The `nodeFilter` is evaluated at traversal time, before the result is materialized. Use it to prune branches that don't match the entity type you want:

```typescript
await graph.traverse({
  start: cookRef,
  maxDepth: 3,
  edgeTypes: ['works_at', 'contains', 'stocks', 'contains'],
  nodeFilter: (node, depth) => {
    if (depth === 0) return true;          // CookProfile
    if (depth === 1) return node.entityType === 'Kitchen';
    if (depth === 2) return node.entityType === 'Inventory';
    if (depth === 3) return node.entityType === 'InventoryBatch';
    return false;
  },
});
```

### 11.3 Prefer `neighborhood` over `traverse` for radius queries
`neighborhood` is optimized for the "everything within k hops" pattern and returns the shortest distance to each node. `traverse` is more general but slower for the same query.

### 11.4 Avoid depth ≥ 5 in synchronous request paths
At depth ≥ 5, the result set on a typical tenant graph exceeds 10k nodes and the query risks breaching the 500ms p99 SLO. For deeper queries, use a snapshot or run the query as a background job:

```typescript
import { GraphQueryJob } from '@eks/food-domain/workers';

const job = await GraphQueryJob.enqueue({
  query: { /* deep traverse spec */ },
  resultFormat: 'jsonld',
  notifyUrl: 'https://app.example.com/webhooks/graph-query-done',
});
// Poll or wait for webhook; result is delivered to object storage.
```

### 11.5 Use `subgraph` for bulk reads
If you need to read more than 1000 nodes, prefer `subgraph` (which streams) over `traverse` (which materializes).

### 11.6 Cache hot neighborhoods
For neighborhoods that are queried frequently (e.g. a popular cook's `follows`), cache the result in the M1 `@eks/cache` with a 5-minute TTL:

```typescript
import { CacheClient } from '@eks/cache';

const cache = new CacheClient(/* ... */);
const cacheKey = `graph:neighborhood:${cookId}:followers:v1`;

const followers = await cache.getOrSet(cacheKey, 300, async () => {
  const r = await graph.neighborhood({
    center: { entityType: 'CookProfile', entityId: cookId },
    radius: 1,
    edgeTypes: ['follows'],
    direction: 'inbound',
  });
  return r.members;
});
```

The cache key includes the entity's `version` if you need stronger consistency:

```typescript
const cook = await graph.getNode('CookProfile', cookId);
const cacheKey = `graph:neighborhood:${cookId}:followers:v${cook.version}`;
```

---

## 12. Error Handling

`GraphEngine` methods throw typed errors from `@eks/food-domain/errors`:

| Error | When |
|---|---|
| `GraphNodeNotFoundError` | The start node does not exist or is not in the tenant. |
| `GraphTraversalTooDeepError` | `maxDepth` exceeds the configured ceiling (default 6). |
| `GraphResultTooLargeError` | Result set exceeds the configured limit (default 10_000 nodes). |
| `GraphProjectionLagError` | Projection lag exceeds the freshness SLO; the engine refuses to serve stale results. |
| `GraphEdgeCycleError` | Attempted to create a `substitutes` edge that would form a cycle. |
| `GraphTenantIsolationError` | Attempted to traverse to a node in a different tenant without global-node exception. |
| `GraphSnapshotNotFoundError` | Snapshot ref does not exist. |

```typescript
import { errors } from '@eks/food-domain';

try {
  await graph.traverse({ /* ... */ });
} catch (e) {
  if (e instanceof errors.GraphResultTooLargeError) {
    // Paginate or narrow the query.
  } else if (e instanceof errors.GraphProjectionLagError) {
    // Retry after a short delay; the projection worker is catching up.
    await sleep(1000);
    return retry();
  } else {
    throw e;
  }
}
```

---

## 13. End-to-End Example: "Suggest Substitutes"

A real-world recommendation scenario: given a recipe ingredient the customer is allergic to, suggest the best substitute that the cook's kitchen currently has in stock.

```typescript
import { GraphClient } from '@eks/food-domain';

async function suggestSubstitute(
  graph: GraphClient,
  params: {
    recipeId: string;
    ingredientId: string;
    cookId: string;
    allergensToAvoid: string[];
  },
): Promise<{ substituteIngredientId: string; ratio: number; reason: string } | null> {
  // 1. Find substitute candidates via 'substitutes' edges.
  const subs = await graph.traverse({
    start: { entityType: 'Ingredient', entityId: params.ingredientId },
    direction: 'outbound',
    edgeTypes: ['substitutes'],
    maxDepth: 1,
    return: 'edges',
  });

  if (subs.edges.length === 0) return null;

  // 2. Filter by allergen safety (read each candidate's full entity).
  const safeCandidates: Array<{ ingredientId: string; ratio: number; reason: string }> = [];
  for (const edge of subs.edges) {
    const subNode = await graph.getNode('Ingredient', edge.toNodeId);
    if (!subNode) continue;
    const allergens: string[] = subNode.properties.allergenFlags ?? [];
    if (allergens.some(a => params.allergensToAvoid.includes(a))) continue;
    safeCandidates.push({
      ingredientId: subNode.entityId,
      ratio: edge.properties.ratio ?? 1,
      reason: edge.properties.reason ?? 'regional-swap',
    });
  }

  if (safeCandidates.length === 0) return null;

  // 3. Find the cook's kitchen's inventory.
  const cookKitchens = await graph.traverse({
    start: { entityType: 'CookProfile', entityId: params.cookId },
    direction: 'outbound',
    edgeTypes: ['works_at', 'stocked_at', 'stocks'],
    maxDepth: 3,
    return: 'nodes',
    nodeFilter: (n, depth) => depth === 3 ? n.entityType === 'InventoryBatch' : true,
  });

  const batchNodeIds = new Set(cookKitchens.nodes.map(n => n.id));

  // 4. For each safe candidate, check if any of the cook's inventory batches
  //    contains that ingredient.
  for (const candidate of safeCandidates) {
    const candidateBatches = await graph.traverse({
      start: { entityType: 'Ingredient', entityId: candidate.ingredientId },
      direction: 'inbound',
      edgeTypes: ['contains'],
      maxDepth: 1,
      return: 'nodes',
      nodeFilter: (n) => n.entityType === 'InventoryBatch',
    });
    const hasStock = candidateBatches.nodes.some(n => batchNodeIds.has(n.id));
    if (hasStock) {
      return candidate;
    }
  }

  return null;
}
```

---

## 14. See Also

- `GRAPH_ARCHITECTURE.md` — engine internals, storage model, performance characteristics.
- `ENTITY_RELATIONSHIPS.md` — full edge vocabulary.
- `API_DOCUMENTATION.md` §11 — REST routes for graph operations.
- `SEARCH_ARCHITECTURE.md` — full-text search as a complement to graph traversal.
- `OPERATIONAL_RUNBOOKS.md` §3 — graph traversal latency SLOs and alerting.
- `docs/developer/ARCHITECTURE.md` — DI container and binding patterns.
- `docs/EVENT_CONVENTIONS.md` — event envelope for graph events.
