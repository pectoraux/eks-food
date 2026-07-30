# Eks-Food Food Intelligence Graph — Architecture

> **Audience:** Platform engineers, data engineers, recommendation/AI engineers, on-call maintainers. Read alongside `DOMAIN_MODEL_REFERENCE.md` (§10 for `Relationship`, `GraphNode`, `GraphEdge`, `EntityVersion`), `ENTITY_RELATIONSHIPS.md` (full edge vocabulary), `GRAPH_QUERY_GUIDE.md` (TypeScript traversal examples), and `OPERATIONAL_RUNBOOKS.md` (graph-size & traversal-latency monitoring).
>
> **Status:** Milestone 6. The Food Intelligence Graph ("the Graph") is the canonical, queryable projection of every cross-entity relationship in the Eks-Food domain. It is materialized in PostgreSQL today and designed to be migratable to a native graph database (Neo4j, ArangoDB, Amazon Neptune) without changing domain logic.

---

## 1. Goals & Non-Goals

### Goals
- Project every domain relationship (cook↔kitchen, recipe↔ingredient, supplier↔ingredient, certification↔cook, inspection↔kitchen, etc.) into a uniform, queryable graph so that *any* "who/what is connected to whom/what" question can be answered in a single traversal.
- Make graph **traversal** first-class: BFS, DFS, shortest-path, k-hop neighborhoods, dependency analysis, cycle detection, subgraph extraction.
- Make graph **temporal**: every edge has `validFrom` / `validUntil`, and every traversal supports an `asOf` parameter to reconstruct the graph as it existed at any point in time.
- Make graph **storage-abstracted**: the `GraphEngine` interface in `@eks/food-domain` is the only surface domain code touches; the underlying implementation (`PostgresGraphEngine` today, `Neo4jGraphEngine` or `ArangoGraphEngine` tomorrow) is injectable.
- Make graph **event-sourced**: every graph mutation is mirrored by a `food-domain.graph.{node,edge}.{operation}.v1` event in the M1 `EventOutbox`, so that downstream systems (the AI recommendation context, the marketplace search index, the analytics context) can maintain their own projections.
- Make graph **snapshotable**: a `GraphSnapshot` captures the entire graph (or a tenant subgraph) at a point in time, for audit, replay, and disaster recovery.

### Non-Goals
- **Replacing the `Relationship` table.** `Relationship` (write-optimized, normalized, audited) remains the source of truth. `GraphEdge` is a read-optimized projection. The `GraphProjectionWorker` reconciles them.
- **Real-time graph streaming.** The graph is updated within ~100ms of a `Relationship` mutation (via the projection worker), not transactionally synchronously. For sub-100ms consistency, callers read `Relationship` directly.
- **Graph-based access control.** Authorization decisions continue to be made by the M2 `@eks/authorization` engine on the entity tables, not the graph. The graph is informational and queryable but never authoritative for permissions.
- **A GraphQL endpoint.** The M6 API surface is REST + the `GraphEngine` TypeScript interface. A GraphQL facade (`/api/v1/food-domain/graphql`) is planned for M7.
- **Machine-learning model training inside the graph engine.** ML pipelines (embeddings, GNNs) consume the graph via `GraphSnapshot` exports; they do not run inside `GraphEngine`.

---

## 2. Two-Layer Storage Model

The Graph is materialized in two layers:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           WRITE PATH                                     │
│                                                                          │
│   Domain Service ─▶ Repository ─▶ Relationship (3NF, audited, source    │
│                                       of truth, versioned)               │
│                                  │                                       │
│                                  │ event: food-domain.relationship.      │
│                                  │        {created,updated,deleted}.v1   │
│                                  ▼                                       │
│                          M1 EventOutbox                                  │
│                                  │                                       │
│                                  ▼                                       │
│                       GraphProjectionWorker                              │
│                       (consumes events, upserts projections)             │
│                                  │                                       │
└──────────────────────────────────┼───────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          READ PATH                                       │
│                                                                          │
│   Application / AI / Search ─▶ GraphEngine ─▶ GraphNode + GraphEdge      │
│                                  (read-optimized, denormalized, indexed) │
│                                                                          │
│                                  │                                       │
│                                  ▼                                       │
│                       Traversal algorithms                               │
│                       (BFS, DFS, shortest-path, neighborhood, cycle)     │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.1 The `Relationship` table (write-optimized)
Documented in `DOMAIN_MODEL_REFERENCE.md` §10.1. Key properties:
- 3NF, fully audited, versioned, soft-deleted.
- Carries `organizationId` for tenant isolation.
- Polymorphic: `fromType` / `fromId` / `toType` / `toId` / `type` strings.
- Temporal: `validFrom` / `validUntil`.
- The **only** table that domain services write to.

### 2.2 The `GraphNode` table (read-optimized)
Documented in `DOMAIN_MODEL_REFERENCE.md` §10.2. Key properties:
- One row per `(entityType, entityId)` pair.
- `label`, `properties`, `tags` denormalized from the source entity for fast filtering without joins.
- `degreeIn` / `degreeOut` maintained by the projection worker.
- `lastSyncedAt` tracks projection freshness.

### 2.3 The `GraphEdge` table (read-optimized)
Documented in `DOMAIN_MODEL_REFERENCE.md` §10.3. Key properties:
- One row per active `Relationship`.
- `weight` numeric for shortest-path & ranking.
- Indexed on `(fromNodeId, type, state)`, `(toNodeId, type, state)`.
- `lastSyncedAt` tracks projection freshness.

### 2.4 Why two layers?
- **Isolation of write amplification.** A `Relationship` write is one row. Updating `degreeIn` / `degreeOut` denormalizations on every node touched is expensive — we defer it to the asynchronous projection worker.
- **Query shape mismatch.** Domain writes are polymorphic (a single `Relationship` row can connect any two entities). Traversal queries are homogeneous (we want "all `Ingredient` nodes within 2 hops of this `Recipe`"). The two-layer split lets each layer use the indexes that suit its access pattern.
- **Migration safety.** If we ever move the read path to Neo4j, the write path (`Relationship`) is untouched. The `GraphProjectionWorker` is replaced by a `Neo4jSyncWorker` that consumes the same events and writes to Neo4j.

---

## 3. The `GraphEngine` Interface

The `GraphEngine` is the **only** abstraction domain code touches. It is defined in `@eks/food-domain/graph/engine` and implemented by `PostgresGraphEngine` (default) today.

```typescript
// src/packages/food-domain/graph/engine.ts
export interface GraphEngine {
  // ── Node operations ────────────────────────────────────────────────────
  upsertNode(node: GraphNodeInput): Promise<GraphNode>;
  getNode(entityType: string, entityId: UUID): Promise<GraphNode | null>;
  deleteNode(entityType: string, entityId: UUID): Promise<void>;

  // ── Edge operations ────────────────────────────────────────────────────
  upsertEdge(edge: GraphEdgeInput): Promise<GraphEdge>;
  getEdge(relationshipId: UUID): Promise<GraphEdge | null>;
  deleteEdge(relationshipId: UUID): Promise<void>;

  // ── Traversal ─────────────────────────────────────────────────────────
  traverse(query: TraversalQuery): Promise<TraversalResult>;
  shortestPath(query: ShortestPathQuery): Promise<GraphPath | null>;
  neighborhood(query: NeighborhoodQuery): Promise<NeighborhoodResult>;
  subgraph(query: SubgraphQuery): Promise<Subgraph>;

  // ── Analytics ─────────────────────────────────────────────────────────
  degree(nodeRef: NodeRef, direction: 'in' | 'out' | 'both'): Promise<number>;
  countEdges(filter: EdgeFilter): Promise<number>;

  // ── Temporal ──────────────────────────────────────────────────────────
  traverseAsOf(query: TraversalQuery, asOf: ISODateString): Promise<TraversalResult>;

  // ── Snapshots ─────────────────────────────────────────────────────────
  createSnapshot(scope: SnapshotScope): Promise<GraphSnapshotRef>;
  loadSnapshot(ref: GraphSnapshotRef): Promise<GraphSnapshot>;
}
```

The interface is deliberately storage-agnostic: it operates on `NodeRef` (`{ entityType, entityId }`) rather than database IDs, and returns plain JSON-serializable objects. Implementations are free to translate to Cypher, AQL, Gremlin, or SQL under the hood.

### 3.1 `PostgresGraphEngine`
The default implementation. Lives in `@eks/food-domain/graph/postgres-engine`. Uses recursive CTEs for BFS/DFS traversal, the `pg_trgm` extension for fuzzy node matching, and materialized views for `degreeIn` / `degreeOut` rollups.

### 3.2 `Neo4jGraphEngine` (future)
Planned for M8 once graph size exceeds ~50M nodes / ~500M edges (the point at which recursive CTEs become prohibitively expensive). The interface is unchanged; only the DI binding swaps. A `Neo4jSyncWorker` consumes the same `food-domain.relationship.*.v1` events and writes Cypher `MERGE` statements.

### 3.3 `ArangoGraphEngine` (future)
Alternative for multi-model deployments that already run ArangoDB. Same event-driven sync; uses AQL for traversal.

---

## 4. Relationship Types (Edge Vocabulary)

The Graph recognizes the following canonical edge types. Each corresponds to a `Relationship.type` string. The vocabulary is closed; new types must be added via an RFC and reflected in `@eks/food-domain/graph/edge-types.ts` (an enum + a Zod schema validator).

| Edge Type | From → To | Cardinality | Notes |
|---|---|---|---|
| `member_of` | `CustomerProfile` → `Household` | N:1 | Customer joins a household. |
| `member_of` | `Region` → `Country` | N:1 | Geography containment. |
| `member_of` | `City` → `Region` | N:1 | |
| `member_of` | `Neighborhood` → `City` | N:1 | |
| `member_of` | `InventoryBatch` → `Inventory` | N:1 | |
| `member_of` | `MenuItem` → `Menu` | N:1 | |
| `works_at` | `CookProfile` → `Kitchen` | M:N | With `properties.role` (`"head-chef"`, `"line-cook"`, `"owner"`). |
| `contains` | `Country` → `Region` | 1:N | Geography. |
| `contains` | `Region` → `City` | 1:N | |
| `contains` | `City` → `Neighborhood` | 1:N | |
| `contains` | `Recipe` → `Ingredient` | M:N | Via `RecipeIngredient`; `properties.weight = quantity`. |
| `contains` | `Menu` → `MenuItem` | 1:N | |
| `contains` | `Kitchen` → `Equipment` | 1:N | |
| `operates` | `Restaurant` → `Kitchen` | 1:N | |
| `operated_by` | `Kitchen` → `Restaurant` | N:1 | Inverse of `operates`. |
| `operated_by` | `Vehicle` → `Restaurant`/`CookProfile`/`Vendor` | N:1 | Polymorphic. |
| `owned_by` | `Menu` → `Restaurant`/`CookProfile`/`Household` | N:1 | Polymorphic. |
| `located_in` | `Household` → `Neighborhood` | N:1 | |
| `located_in` | `Kitchen` → `Neighborhood` | N:1 | |
| `located_in` | `Restaurant` → `Neighborhood` | N:1 | |
| `located_in` | `Supplier` → `Neighborhood` | N:1 | |
| `lives_in` | `CustomerProfile` → `Neighborhood` | N:1 | |
| `supplies` | `Supplier` → `Ingredient` | M:N | Supplier catalog. |
| `supplies_to` | `Supplier` → `Kitchen` | M:N | Supplier↔kitchen contract. |
| `stocks` | `Inventory` → `InventoryBatch` | 1:N | |
| `stocked_at` | `Inventory` → `Kitchen` | 1:1 | |
| `inspects` | `Inspection` → `{Cook,Kitchen,Restaurant,Supplier,Vendor}` | N:1 | Polymorphic via `subjectType`. |
| `certified_by` | `{Cook,Kitchen,Restaurant,Supplier,Vendor}` → `Certification` | 1:N | Polymorphic. |
| `authored_by` | `Recipe` → `CookProfile` | N:1 | |
| `featured_in` | `Recipe` → `MenuItem` | 1:N | |
| `derived_from` | `MenuItem` → `Recipe` | N:1 | |
| `produces` | `Kitchen` → `MenuItem` | 1:N | |
| `produced_at` | `MenuItem` → `Kitchen` | N:1 | |
| `requires` | `RecipeStep` → `Equipment` | M:N | By `kind`. |
| `follows` | `CustomerProfile` → `CookProfile` | M:N | Social graph. |
| `substitutes` | `Ingredient` → `Ingredient` | M:N | With `properties.ratio` and `properties.reason`. |
| `partner_of` | `Vendor` → `Restaurant` | M:N | Marketplace partnership. |
| `fork_from` | `Recipe` → `Recipe` | N:1 | Tenant forks platform recipe. |

Edge types are typed in `@eks/food-domain/graph/edge-types.ts`:

```typescript
export const EDGE_TYPES = [
  'member_of', 'works_at', 'contains', 'operates', 'operated_by',
  'owned_by', 'located_in', 'lives_in', 'supplies', 'supplies_to',
  'stocks', 'stocked_at', 'inspects', 'certified_by', 'authored_by',
  'featured_in', 'derived_from', 'produces', 'produced_at', 'requires',
  'follows', 'substitutes', 'partner_of', 'fork_from',
] as const;
export type EdgeType = typeof EDGE_TYPES[number];
```

---

## 5. Graph Traversal

The `GraphEngine.traverse` operation supports BFS, DFS, and constrained random walks. The query shape:

```typescript
export interface TraversalQuery {
  start: NodeRef | NodeRef[];            // one or more starting nodes
  direction: 'outbound' | 'inbound' | 'any';
  edgeTypes?: EdgeType[];                // filter; omit for all
  maxDepth: number;                      // 1–6 (configurable ceiling)
  nodeFilter?: NodePredicate;            // filter at traversal time
  edgeFilter?: EdgePredicate;
  uniqueNodes: boolean;                  // visit each node at most once (default true)
  uniqueEdges: boolean;                  // traverse each edge at most once (default true)
  limit?: number;                        // cap result size
  return: 'nodes' | 'edges' | 'paths' | 'subgraph';
  organizationId?: UUID;                 // tenant scoping
}
```

### 5.1 BFS (Breadth-First Search)
Default traversal mode. Visits nodes in order of distance from the start. Used for "find all `Ingredient`s in any recipe within 2 hops of this cook" queries.

The `PostgresGraphEngine` implements BFS via a recursive CTE:

```sql
WITH RECURSIVE bfs AS (
  SELECT node_id, 0 AS depth, ARRAY[node_id] AS path
  FROM graph_nodes
  WHERE entity_type = $1 AND entity_id = $2
  UNION ALL
  SELECT ge.to_node_id, b.depth + 1, b.path || ge.to_node_id
  FROM bfs b
  JOIN graph_edges ge ON ge.from_node_id = b.node_id
  WHERE b.depth < $3
    AND ge.state = 'ACTIVE'
    AND ($4::text[] IS NULL OR ge.type = ANY($4::text[]))
    AND NOT (ge.to_node_id = ANY(b.path))
)
SELECT * FROM bfs WHERE depth <= $3;
```

### 5.2 DFS (Depth-First Search)
Used for cycle detection and topological sort (e.g. validating that an `Ingredient` substitution graph has no cycles). Enabled by setting `algorithm: 'dfs'` on the `TraversalQuery`.

### 5.3 Shortest-Path
`GraphEngine.shortestPath` returns the minimum-hop path between two nodes, optionally weighted by `GraphEdge.weight`. The Postgres implementation uses a bidirectional BFS with early termination; for weighted paths it falls back to Dijkstra.

```typescript
export interface ShortestPathQuery {
  from: NodeRef;
  to: NodeRef;
  edgeTypes?: EdgeType[];
  weighted?: boolean;                    // use GraphEdge.weight; default false (hop count)
  maxDepth?: number;                     // default 6
  organizationId?: UUID;
}
```

### 5.4 Neighborhood Analysis
`GraphEngine.neighborhood` returns the k-hop neighborhood of a node — the set of nodes within `k` hops, with their distances and edge types. Used for "what does this cook depend on?" (1-hop: kitchens; 2-hop: equipment, inventory; 3-hop: suppliers, ingredients).

```typescript
export interface NeighborhoodQuery {
  center: NodeRef;
  radius: number;                        // 1–4
  edgeTypes?: EdgeType[];
  direction?: 'outbound' | 'inbound' | 'any';
  nodeTypes?: string[];                  // filter result to specific entity types
  organizationId?: UUID;
}

export interface NeighborhoodResult {
  center: GraphNode;
  members: Array<{
    node: GraphNode;
    distance: number;
    viaEdgeType: EdgeType;
    path: UUID[];                        // node IDs along the shortest path
  }>;
  stats: { totalNodes: number; totalEdges: number; byDistance: Record<number, number> };
}
```

### 5.5 Subgraph Extraction
`GraphEngine.subgraph` returns a complete subgraph (nodes + edges) rooted at a starting set, bounded by depth and edge types. Used for graph visualization, ML feature extraction, and snapshot export.

---

## 6. Temporal Relationships

Every `Relationship` (and its `GraphEdge` projection) carries `validFrom` and `validUntil`. This enables **as-of** queries: "what did the supply chain for this ingredient look like on 2024-06-01?"

The `GraphEngine.traverseAsOf` operation accepts an `asOf: ISODateString` parameter and filters edges to those where `validFrom <= asOf AND (validUntil IS NULL OR validUntil > asOf)`.

```typescript
const supplyChain = await graphEngine.traverseAsOf({
  start: { entityType: 'Ingredient', entityId: tomatoId },
  direction: 'inbound',
  edgeTypes: ['supplies', 'supplies_to', 'stocks'],
  maxDepth: 3,
  return: 'subgraph',
}, '2024-06-01T00:00:00Z');
```

Temporal queries are O(edges-in-window) — the `GraphEdge` table is indexed on `(validFrom, validUntil, state)`.

### 6.1 Edge Supersession
When a `Relationship` is updated (e.g. a cook moves from Kitchen A to Kitchen B), the old edge is **superseded**, not deleted:

1. The old `Relationship` row is set to `state = 'SUPERSEDED'`, `validUntil = now()`.
2. A new `Relationship` row is created with `state = 'ACTIVE'`, `validFrom = now()`, `validUntil = null`.
3. The projection worker updates `GraphEdge` accordingly: the old edge is marked `SUPERSEDED`; the new edge is `ACTIVE`.

This preserves the full history of every relationship without inflating the active edge set.

---

## 7. Graph Snapshots

A `GraphSnapshot` is a point-in-time, immutable copy of (a tenant-scoped subgraph of) the Graph. Stored in the `GraphSnapshot` table:

| Field | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key. |
| `organizationId` | `UUID?` | Null for global snapshots. |
| `scope` | `JSON` | `{ entityTypes?: string[], edgeTypes?: EdgeType[], centerNodeId?: UUID, radius?: number }`. |
| `nodeCount` | `Int` | |
| `edgeCount` | `Int` | |
| `contentHash` | `String` | SHA-256 of the serialized snapshot. |
| `storageKey` | `String` | Object-store key (S3/MinIO) for the serialized payload. |
| `createdAt` | `DateTime` | |
| `createdBy` | `UUID` | FK → `User.id`. |
| `metadata` | `JSON` | |

Snapshots are triggered by:
1. **Scheduled jobs** — nightly full-tenant snapshots for disaster recovery.
2. **Manual operator action** — `POST /api/v1/food-domain/graph/snapshots`.
3. **Major schema migrations** — pre-migration snapshot for rollback safety.
4. **ML pipeline triggers** — the AI context takes a snapshot before each model training run to ensure reproducibility.

Snapshot payloads are serialized as JSON-LD (with `@context` referencing `https://schema.eks-food.com/graph/v1`) and stored in the M1 object store. The content hash enables deduplication and integrity verification on restore.

---

## 8. Graph Events

Every graph mutation emits an event to the M1 `EventOutbox`. The event taxonomy (defined in `@eks/food-domain/graph/events.ts`):

| Event Type | Payload | Subscribers |
|---|---|---|
| `food-domain.graph.node.created.v1` | `{ entityType, entityId, label, properties, tags }` | `SearchIndexWorker`, AI context, analytics |
| `food-domain.graph.node.updated.v1` | `{ entityType, entityId, label, properties, tags, diff }` | `SearchIndexWorker`, AI context |
| `food-domain.graph.node.deleted.v1` | `{ entityType, entityId }` | `SearchIndexWorker`, AI context |
| `food-domain.graph.edge.created.v1` | `{ relationshipId, fromNode, toNode, type, properties, validFrom }` | AI context, analytics |
| `food-domain.graph.edge.updated.v1` | `{ relationshipId, diff, validFrom, validUntil }` | AI context |
| `food-domain.graph.edge.superseded.v1` | `{ relationshipId, supersededBy, validUntil }` | AI context, audit |
| `food-domain.graph.edge.deleted.v1` | `{ relationshipId }` | AI context, audit |
| `food-domain.graph.snapshot.created.v1` | `{ snapshotId, scope, nodeCount, edgeCount, contentHash }` | Audit, DR |
| `food-domain.graph.projection.lag.v1` | `{ lagMs, pendingEvents }` | Ops alerting (consumed by `@eks/observability`) |

All events follow the M1 `DomainEvent` envelope (`eventId`, `occurredAt`, `tenantId`, `actorId`, `correlationId`, `causationId`, `version`, `payload`); see `docs/EVENT_CONVENTIONS.md`.

---

## 9. The `GraphProjectionWorker`

The `GraphProjectionWorker` is a M1 `@eks/workers` consumer that subscribes to `food-domain.relationship.*.v1` and `food-domain.{entity}.{operation}.v1` events and updates the `GraphNode` / `GraphEdge` projections. It runs as a single-consumer queue (no parallelism per tenant) to preserve ordering within a tenant.

### 9.1 Projection algorithm
For each event:
1. **`relationship.created.v1`** — UPSERT the corresponding `GraphEdge` row. Update `degreeIn` / `degreeOut` on the affected nodes via a single SQL `UPDATE ... SET degree = degree + 1`.
2. **`relationship.updated.v1`** — UPSERT the `GraphEdge` with new `properties` / `weight` / `validFrom`.
3. **`relationship.superseded.v1`** — Mark the old `GraphEdge` as `SUPERSEDED`, decrement the old node degrees, insert the new `GraphEdge`, increment the new node degrees.
4. **`relationship.deleted.v1`** — Mark `GraphEdge` as `DELETED`, decrement degrees.
5. **`{entity}.created.v1`** — UPSERT the corresponding `GraphNode` row.
6. **`{entity}.updated.v1`** — UPSERT the `GraphNode` with new `label` / `properties` / `tags`.
7. **`{entity}.deleted.v1`** — Mark `GraphNode` as deleted (or hard-delete if no edges reference it).

### 9.2 Reconciliation
A nightly `GraphReconciliationJob` scans for drift between `Relationship` and `GraphEdge`:
- Detects `Relationship` rows with `state = 'ACTIVE'` that have no corresponding `GraphEdge` (projection lag).
- Detects `GraphEdge` rows with `state = 'ACTIVE'` whose source `Relationship` is `SUPERSEDED` or `DELETED` (orphan edges).
- Detects `degreeIn` / `degreeOut` values that don't match `COUNT(*)` on `GraphEdge`.

Drift is repaired by re-projecting the affected nodes. Drift counts are emitted as metrics (`graph.projection.drift.{nodes,edges,degrees}`) and alertable via the M1 `@eks/observability` stack.

---

## 10. Tenant Isolation in the Graph

The Graph is tenant-isolated at the edge level: every `GraphEdge` carries `organizationId`, and every `GraphEngine` query accepts an optional `organizationId` filter. The `PostgresGraphEngine` injects the filter into every SQL query as an additional `WHERE` clause.

Cross-tenant traversal is **forbidden** by default. A `GraphEngine.traverse` call that starts in tenant A and reaches a node in tenant B returns an empty result for the cross-tenant leg (the edges are filtered out before traversal).

The exception is the **global subgraph**: `Country`, `Region`, `City`, `Neighborhood`, `Ingredient`, and global `Recipe` rows have `organizationId = null` and are traversable from any tenant. This lets a tenant query "which suppliers supply tomato" (tomato is global; the supplier is tenant-scoped) without leakage.

---

## 11. Performance Characteristics

| Operation | Postgres latency (p50) | Postgres latency (p99) | Notes |
|---|---|---|---|
| `getNode` | 0.4 ms | 1.2 ms | Indexed PK lookup. |
| `upsertNode` | 0.8 ms | 2.5 ms | Single-row UPSERT. |
| `upsertEdge` | 1.2 ms | 4.0 ms | UPSERT + two degree updates. |
| `traverse` BFS depth-2 | 8 ms | 35 ms | Recursive CTE; result set typically 10–500 nodes. |
| `traverse` BFS depth-3 | 25 ms | 120 ms | |
| `traverse` BFS depth-4 | 90 ms | 500 ms | Approaching the configured ceiling; consider snapshot. |
| `shortestPath` (unweighted, depth ≤ 4) | 6 ms | 30 ms | Bidirectional BFS. |
| `shortestPath` (weighted, Dijkstra) | 40 ms | 200 ms | Falls back to Dijkstra when `weighted: true`. |
| `neighborhood` radius-2 | 12 ms | 50 ms | |
| `traverseAsOf` | 1.5× `traverse` | 1.5× `traverse` | Additional `validFrom`/`validUntil` filter. |
| `createSnapshot` (1M-edge subgraph) | ~45 s | ~90 s | Serialized to object store. |
| `loadSnapshot` | ~5 s | ~15 s | Inflated from object store. |

SLOs and alerting thresholds are defined in `OPERATIONAL_RUNBOOKS.md` §3.

### 11.1 Traversal Depth Ceiling
The default `maxDepth` ceiling is **6** hops. This is a deliberate safeguard: at depth ≥ 7, the result set on a connected tenant graph typically exceeds 100k nodes, at which point the caller should use a snapshot or an offline batch job. The ceiling is configurable per tenant via the M2 `TenantConfiguration` table (`foodDomain.graph.maxTraversalDepth`).

### 11.2 Result-Size Limits
`traverse` enforces a default `limit = 10_000` nodes / 25_000 edges. Callers needing larger result sets must page (via `cursor` returned in the result) or use `subgraph` extraction to a snapshot.

---

## 12. Migration Path to a Native Graph DB

When the Postgres implementation hits its performance ceiling (estimated at ~50M nodes / ~500M edges, or sustained p99 > 500ms for depth-3 traversals), the migration to Neo4j (or ArangoDB) proceeds as follows:

1. **Deploy the new engine in parallel.** A `Neo4jSyncWorker` is deployed alongside `GraphProjectionWorker`, consuming the same events and writing to Neo4j.
2. **Backfill from snapshots.** The latest `GraphSnapshot` is loaded into Neo4j in bulk (`LOAD CSV` or `neo4j-admin import`).
3. **Cut over reads.** The `@eks/food-domain` DI binding switches from `PostgresGraphEngine` to `Neo4jGraphEngine`. The M2 `FeatureFlag` `food-domain.graph.engine` controls the rollout (canary by tenant).
4. **Decommission Postgres projections.** Once Neo4j has served 100% of read traffic for 30 days without rollback, the `GraphProjectionWorker` is repurposed to write only to Neo4j; the `GraphNode` / `GraphEdge` tables are retained for 90 days as a fallback, then dropped.

Domain code is **untouched** throughout the migration: every call goes through `GraphEngine`, and the `Relationship` write path is unchanged.

---

## 13. See Also

- `DOMAIN_MODEL_REFERENCE.md` §10 — `Relationship`, `GraphNode`, `GraphEdge`, `EntityVersion` table definitions.
- `ENTITY_RELATIONSHIPS.md` — every edge type with cardinality and ASCII diagram.
- `GRAPH_QUERY_GUIDE.md` — TypeScript code examples for BFS, shortest-path, neighborhood, dependency analysis, as-of queries, snapshots.
- `API_DOCUMENTATION.md` §6 — `/api/v1/food-domain/graph/*` REST routes.
- `OPERATIONAL_RUNBOOKS.md` §3 — graph size, projection lag, traversal latency monitoring.
- `docs/EVENT_CONVENTIONS.md` — M1 event envelope.
- `docs/developer/ARCHITECTURE.md` — DI and binding patterns.
