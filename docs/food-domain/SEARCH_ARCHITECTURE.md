# Eks-Food Search Architecture

> **Audience:** Platform engineers, search engineers, application developers, AI/recommendation engineers. Read alongside `DOMAIN_MODEL_REFERENCE.md` (entities being indexed), `GRAPH_QUERY_GUIDE.md` (graph traversal as a complement to search), `API_DOCUMENTATION.md` §12 (search REST routes), `OPERATIONAL_RUNBOOKS.md` §4 (search latency SLOs).
>
> **Status:** Milestone 6. This document describes the canonical search infrastructure that indexes every Eks-Food food-domain entity and serves full-text, faceted, fuzzy, autocomplete, and multilingual queries.

---

## 1. Goals & Non-Goals

### Goals
- Make **every canonical entity** searchable: `Country`, `Region`, `City`, `Neighborhood`, `Household`, `CustomerProfile`, `CookProfile`, `Restaurant`, `Kitchen`, `Ingredient`, `Recipe`, `Menu`, `MenuItem`, `Inventory`, `InventoryBatch`, `Equipment`, `Vehicle`, `Supplier`, `Vendor`, `Certification`, `Inspection`, `FoodSafetyIncident`, `NutritionProfile`.
- Support **five search modes**: full-text, faceted, autocomplete, fuzzy (1 edit distance), and synonym-aware.
- Support **multilingual search**: indexed text is tokenized per locale; queries are routed to the locale-specific index.
- Make search **storage-abstracted**: the `SearchIndex` interface in `@eks/food-domain/search` is the only surface domain code touches; the underlying implementation (`PostgresSearchIndex` today, `MeilisearchIndex` or `ElasticsearchIndex` tomorrow) is injectable.
- Make search **eventually consistent** with the canonical entities: an entity write emits a domain event; a `SearchIndexWorker` consumes the event and updates the index within ~1s.
- Make search **tenant-isolated**: every indexed document carries `organizationId`; queries are scoped to the caller's tenant (with the documented global-data exception for `Country`, `Region`, `City`, `Neighborhood`, `Ingredient`).

### Non-Goals
- **Replacing the database.** Search is a *projection*; the canonical entities remain the source of truth. Search results are always joinable back to the entity by `id`.
- **Real-time indexing.** Indexing is asynchronous; the index may lag the canonical entity by up to 1 second. For reads requiring strict consistency, query the entity directly.
- **Cross-tenant search.** Search is tenant-isolated. There is no global search endpoint.
- **Replacing the graph traversal.** Search answers "find entities matching this text"; graph traversal answers "find entities connected to this one". They are complementary; the AI context uses both.
- **A standalone search UI.** The search API is consumed by the marketplace UI, the cook workspace, the admin console, and the AI assistant. Each renders its own UI.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              WRITE PATH                                      │
│                                                                              │
│  Domain Service ─▶ Repository ─▶ Prisma (canonical entity)                   │
│                       │                                                      │
│                       │ event: food-domain.{entity}.{operation}.v1           │
│                       ▼                                                      │
│                   M1 EventOutbox                                             │
│                       │                                                      │
│                       ▼                                                      │
│              SearchIndexWorker                                               │
│              (consumes events, upserts/deletes index docs)                   │
│                       │                                                      │
│                       ▼                                                      │
│              SearchIndex (interface)                                         │
│                 ┌──────────────────────────────────────────┐                 │
│                 │  PostgresSearchIndex (default)            │                 │
│                 │  - search_documents table                 │                 │
│                 │  - search_index_entries table             │                 │
│                 │  - pg_trgm trigram index                  │                 │
│                 │  - GIN index on JSONB facets              │                 │
│                 │  - materialized autocomplete view         │                 │
│                 └──────────────────────────────────────────┘                 │
│                 ┌──────────────────────────────────────────┐                 │
│                 │  MeilisearchIndex (future)                │                 │
│                 │  ElasticsearchIndex (future)              │                 │
│                 └──────────────────────────────────────────┘                 │
└──────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              READ PATH                                       │
│                                                                              │
│  Application / AI / UI ─▶ SearchClient ─▶ SearchIndex                        │
│                             (full-text, facets, autocomplete, fuzzy, syn)    │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The `SearchIndex` Interface

```typescript
// src/packages/food-domain/search/index.ts
export interface SearchIndex {
  // ── Indexing ──────────────────────────────────────────────────────────
  upsert(doc: SearchDocument): Promise<void>;
  upsertBatch(docs: SearchDocument[]): Promise<void>;
  delete(entityType: string, entityId: UUID): Promise<void>;

  // ── Query ─────────────────────────────────────────────────────────────
  search(query: SearchQuery): Promise<SearchResult>;
  autocomplete(query: AutocompleteQuery): Promise<AutocompleteResult>;
  facets(query: FacetQuery): Promise<FacetResult>;

  // ── Management ────────────────────────────────────────────────────────
  reindex(scope: ReindexScope): Promise<ReindexJobRef>;
  reindexStatus(jobRef: ReindexJobRef): Promise<ReindexJobStatus>;
  stats(): Promise<SearchIndexStats>;
}
```

The `SearchDocument` shape:

```typescript
export interface SearchDocument {
  entityType: string;            // 'Recipe', 'Ingredient', ...
  entityId: UUID;
  organizationId: UUID | null;   // null for global entities
  tenant: string;                // tenant slug for routing
  locale: string;                // primary locale of the document
  // Localized text fields, one sub-field per locale:
  text: {
    [locale: string]: {
      title?: string;
      description?: string;
      aliases?: string[];
      body?: string;             // additional searchable text
    };
  };
  // Facet fields (used for filtering and aggregation):
  facets: {
    cuisine?: string[];
    course?: string[];
    allergens?: string[];
    dietaryFlags?: string[];
    state?: string;
    category?: string;
    neighborhoodId?: UUID;
    cookProfileId?: UUID;
    // ...
  };
  // Numeric fields (used for sorting and range filters):
  numbers: {
    price?: number;
    ratingAverage?: number;
    servings?: number;
    totalDurationMinutes?: number;
  };
  // Tags (used for keyword matching and filtering):
  tags: string[];
  // Metadata fields indexed per tenant config:
  metadata?: Record<string, string | number | boolean>;
  // Search ranking signal:
  popularityScore: number;       // 0–1, derived from recent views/orders
  updatedAt: ISODateString;
}
```

---

## 4. Search Modes

### 4.1 Full-Text Search
The default mode. Tokenizes the query, matches against the locale-specific `text` fields, ranks by BM25 (Postgres `tsvector` / `ts_rank`) with a popularity boost.

```typescript
const result = await search.search({
  query: 'jollof rice',
  entityTypes: ['Recipe', 'MenuItem'],
  locale: 'en',
  organizationId: 'org-123',
  page: 1,
  pageSize: 20,
});
```

**Ranking formula:**
```
score = bm25(text.match) * 0.7 + popularityScore * 0.2 + recencyBoost * 0.1
```
Where `recencyBoost = max(0, 1 - daysSinceUpdated / 90)`.

### 4.2 Faceted Search
Returns search hits plus aggregated counts for each facet value. Used to render the marketplace sidebar.

```typescript
const result = await search.search({
  query: 'rice',
  entityTypes: ['Recipe', 'MenuItem'],
  facets: ['cuisine', 'course', 'allergens', 'cookProfileId'],
  filters: {
    cuisine: ['west-african', 'levantine'],
    allergens: { notIn: ['peanut'] },      // exclude peanut
  },
  locale: 'en',
  organizationId: 'org-123',
});

console.log(result.facets);
// {
//   cuisine: [
//     { value: 'west-african', count: 142 },
//     { value: 'levantine', count: 38 },
//     { value: 'indian', count: 27 },
//     ...
//   ],
//   course: [ { value: 'dinner', count: 187 }, ... ],
//   allergens: [ { value: 'gluten', count: 142 }, ... ],
//   cookProfileId: [ { value: '550e...', count: 18, label: 'Amara Boateng' }, ... ],
// }
```

### 4.3 Autocomplete
A fast prefix-match query used for typeahead. Backed by a materialized trigram index.

```typescript
const result = await search.autocomplete({
  query: 'jol',
  entityTypes: ['Recipe', 'MenuItem', 'Ingredient'],
  locale: 'en',
  organizationId: 'org-123',
  limit: 8,
});

console.log(result.suggestions);
// [
//   { entityType: 'Recipe',     entityId: '...', label: 'Jollof Rice',         highlight: '<b>Jol</b>lof Rice' },
//   { entityType: 'MenuItem',   entityId: '...', label: 'Jollof Bowl',         highlight: '<b>Jol</b>lof Bowl' },
//   { entityType: 'Ingredient', entityId: '...', label: 'Jollof Spice Mix',    highlight: '<b>Jol</b>lof Spice Mix' },
//   ...
// ]
```

### 4.4 Fuzzy Search
Matches within 1 edit distance (Levenshtein) to tolerate typos. Implemented via Postgres `pg_trgm` similarity.

```typescript
const result = await search.search({
  query: 'tomato',              // user types 'tomato' or 'tomatoe' or 'tomat'
  entityTypes: ['Ingredient'],
  fuzzy: { enabled: true, maxEdits: 1, prefixLength: 2 },
  locale: 'en',
  organizationId: 'org-123',
});
```

Fuzzy search is **opt-in** per query (not enabled by default) because it increases query latency ~2×. The `prefixLength: 2` parameter requires the first two characters to match exactly, preventing absurd matches.

### 4.5 Synonym-Aware Search
The search engine applies a synonym map at query time. Synonyms are tenant-configurable via `TenantConfiguration.foodDomain.search.synonyms`:

```json
{
  "foodDomain": {
    "search": {
      "synonyms": [
        ["tomato", "nyanya", "tomate"],
        ["rice", "mchele", "riz"],
        ["pepper", "pilipili", "piment"]
      ]
    }
  }
}
```

The synonym map is symmetric within each group: a search for "tomato" matches documents containing "nyanya" or "tomate". Synonyms are locale-scoped — a synonym group applies only to the locales of its members (matched by BCP-47 prefix).

### 4.6 Multilingual Search
Each document is indexed with locale-specific `text` sub-fields. The query's `locale` parameter selects which sub-field to search:

- A search with `locale: "en"` matches the `text.en` fields.
- A search with `locale: "sw"` matches the `text.sw` fields.
- If the locale has no indexed text (e.g. a document with only `text.en` and the query is `locale: "sw"`), the engine falls back to the tenant's default locale, then to `"en"`.

For cross-locale search (e.g. "find me recipes whose name in any language contains 'tomato'"), pass `locale: "*"`:

```typescript
const result = await search.search({
  query: 'tomato',
  locale: '*',                  // search across all indexed locales
  entityTypes: ['Ingredient'],
  organizationId: 'org-123',
});
```

---

## 5. Indexing

### 5.1 Indexing triggers
The `SearchIndexWorker` consumes domain events from the M1 `EventOutbox` and updates the search index:

| Event | Indexing action |
|---|---|
| `food-domain.{entity}.created.v1` | UPSERT document. |
| `food-domain.{entity}.updated.v1` | UPSERT document (full re-index of the entity's document). |
| `food-domain.{entity}.deleted.v1` | DELETE document. |
| `food-domain.{entity}.state-transition.v1` | UPSERT (the `state` facet changes). |
| `food-domain.relationship.{created,updated,deleted}.v1` | UPSERT documents for both endpoints (denormalized facet fields may change, e.g. `cookProfileId` on `MenuItem`). |
| `food-domain.graph.node.updated.v1` | UPSERT (tags and properties may have changed). |

### 5.2 Document construction
For each canonical entity, the worker constructs a `SearchDocument` by:

1. Reading the entity row from Prisma.
2. Extracting localized text fields (`name`, `title`, `description`, `bio`, `aliases`) into `text.{locale}`.
3. Extracting facet fields from JSON columns (`cuisines`, `allergens`, `dietaryFlags`, `state`, `category`) into `facets`.
4. Extracting numeric fields (`price`, `ratingAverage`, `servings`) into `numbers`.
5. Extracting tags from `GraphNode.tags` (the graph projection is the source of truth for tags).
6. Computing `popularityScore` from the M1 `@eks/observability` event store (recent views, orders, follows).
7. Setting `updatedAt` from the entity's `updatedAt`.

The construction logic is per-entity-type, defined in `@eks/food-domain/search/builders/{entityType}.ts`. Adding a new entity type requires a new builder module.

### 5.3 Batch reindex
For initial bootstrap, schema migration, or index corruption recovery, the `reindex` operation rebuilds the index from the canonical entities:

```typescript
const job = await search.reindex({
  scope: {
    organizationId: 'org-123',
    entityTypes: ['Recipe', 'Ingredient'],
    batchSize: 500,
  },
});

// Poll:
const status = await search.reindexStatus(job);
console.log(status);
// { state: 'running', processed: 4500, total: 12000, errors: 0, startedAt: '...', eta: '...' }
```

Reindex jobs are idempotent and can be run in parallel with live indexing (the live indexer wins on conflict because it operates on fresher data).

### 5.4 Index deletion on tenant offboarding
When a tenant is offboarded (M2 `Organization` deletion), the `TenantOffboardingJob` calls `search.deleteByTenant(organizationId)` to remove all documents for that tenant. The deletion is batched (1000 documents per batch) and is audited via the M2 `AuditLog`.

---

## 6. Storage Implementations

### 6.1 `PostgresSearchIndex` (default)
Lives in `@eks/food-domain/search/postgres-index`. Uses two tables:

**`search_documents`** — one row per indexed document.

| Column | Type | Notes |
|---|---|---|
| `entity_type` | `String` | Partition key. |
| `entity_id` | `UUID` | Partition key. |
| `organization_id` | `UUID?` | |
| `tenant` | `String` | Tenant slug. |
| `locale` | `String` | Primary locale. |
| `text` | `JSONB` | `{ en: { title, description, ... }, sw: { ... } }`. |
| `text_tsv` | `tsvector` | Generated from `text` per locale, weighted (A=title, B=aliases, C=description, D=body). |
| `facets` | `JSONB` | |
| `numbers` | `JSONB` | |
| `tags` | `text[]` | |
| `metadata` | `JSONB` | |
| `popularity_score` | `Float` | |
| `updated_at` | `timestamptz` | |

**`search_index_entries`** — materialized autocomplete view, refreshed every 5 minutes by a cron job.

Indexes:
- Primary: `(entity_type, entity_id)`.
- GIN on `text_tsv` (per-locale via partial indexes).
- GIN on `facets jsonb_path_ops`.
- GIN on `tags`.
- `pg_trgm` GIN on extracted `text.*.title` for fuzzy + autocomplete.
- B-tree on `(organization_id, entity_type, updated_at)`.

### 6.2 `MeilisearchIndex` (planned)
For tenants requiring sub-50ms search latency at scale (>1M documents per tenant). Meilisearch provides built-in typo tolerance, faceting, and synonym support. The `SearchIndex` interface is unchanged; only the DI binding swaps.

### 6.3 `ElasticsearchIndex` (planned)
For tenants with advanced analytics needs (aggregations, time-series, multi-tenant index isolation). Same interface; the implementation translates `SearchQuery` to Elasticsearch DSL.

### 6.4 Migration path
Tenants can opt into Meilisearch or Elasticsearch via `TenantConfiguration.foodDomain.search.engine`. The platform runs the configured engine in parallel with Postgres during a 30-day canary; if all queries succeed, Postgres is decommissioned for that tenant. The migration is per-tenant, not platform-wide.

---

## 7. The `SearchQuery` DSL

```typescript
export interface SearchQuery {
  query: string;                          // the search text
  entityTypes?: string[];                 // filter; omit for all
  locale?: string;                        // BCP-47 or '*'; defaults to tenant default
  organizationId: UUID;                   // tenant scope (injected by SearchClient)

  // Filtering
  filters?: {
    [facet: string]:
      | string[]                                       // IN
      | { in: string[] }
      | { notIn: string[] }
      | { eq: string }
      | { neq: string }
      | { gte: number; lte: number }                   // range (numeric facets)
      | { exists: boolean };
  };

  // Faceting
  facets?: string[];                      // facets to aggregate

  // Fuzzy
  fuzzy?: {
    enabled: boolean;
    maxEdits: 1 | 2;                      // 1 by default
    prefixLength: number;                 // 2 by default
  };

  // Synonyms
  synonyms?: boolean;                     // default true; can be disabled

  // Pagination
  page?: number;                          // 1-based; default 1
  pageSize?: number;                      // default 20; max 100
  cursor?: string;                        // alternative to page for deep pagination

  // Sorting
  sort?: Array<{ field: string; order: 'asc' | 'desc' }>;
  // Default: by relevance score, then popularity, then recency.

  // Boosting
  boost?: {
    fields?: { [field: string]: number }; // e.g. { 'text.en.title': 3.0 }
    popularity?: number;                  // weight on popularity; default 0.2
    recency?: number;                     // weight on recency; default 0.1
  };

  // Highlighting
  highlight?: {
    fields: string[];                     // e.g. ['text.en.title', 'text.en.description']
    preTag?: string;                      // default '<b>'
    postTag?: string;                     // default '</b>'
    fragmentSize?: number;                // default 150 chars
  };

  // Result shape
  includeFields?: string[];               // whitelist; omit for all
  excludeFields?: string[];               // blacklist
}
```

### 7.1 Example: marketplace recipe search
```typescript
const result = await search.search({
  query: 'jollof rice',
  entityTypes: ['Recipe', 'MenuItem'],
  locale: 'en',
  organizationId: 'org-123',
  filters: {
    cuisine: ['west-african'],
    allergens: { notIn: ['peanut'] },
    'numbers.totalDurationMinutes': { gte: 15, lte: 90 },
  },
  facets: ['cuisine', 'course', 'cookProfileId'],
  fuzzy: { enabled: true, maxEdits: 1, prefixLength: 2 },
  sort: [{ field: 'popularity', order: 'desc' }],
  boost: { fields: { 'text.en.title': 3.0 } },
  highlight: { fields: ['text.en.title', 'text.en.description'] },
  page: 1,
  pageSize: 20,
});
```

### 7.2 Example: cook-workspace ingredient search
```typescript
const result = await search.search({
  query: 'tomato',
  entityTypes: ['Ingredient'],
  locale: 'en',
  organizationId: 'org-123',
  filters: {
    'facets.category': ['vegetable', 'fruit'],
  },
  facets: ['category', 'allergens', 'dietaryFlags'],
  fuzzy: { enabled: true, maxEdits: 1, prefixLength: 2 },
  page: 1,
  pageSize: 50,
});
```

---

## 8. Autocomplete

```typescript
export interface AutocompleteQuery {
  query: string;                          // typically 2+ characters
  entityTypes?: string[];
  locale?: string;
  organizationId: UUID;
  filters?: SearchQuery['filters'];
  limit?: number;                         // default 8; max 20
  highlight?: { preTag?: string; postTag?: string };
}

export interface AutocompleteResult {
  suggestions: Array<{
    entityType: string;
    entityId: UUID;
    label: string;
    highlight: string;
    score: number;
  }>;
  tookMs: number;
}
```

The autocomplete index is a materialized trigram view refreshed every 5 minutes. For sub-second freshness, callers can hit the live `search` endpoint with a prefix query (less efficient but always current).

---

## 9. Indexing on Entity Create/Update/Delete

The end-to-end indexing flow:

```
1. Client calls POST /api/v1/food-domain/recipes
2. API handler authenticates, validates, calls RecipeService.create()
3. RecipeService.create():
   a. Writes Recipe row to Prisma (transaction 1).
   b. Writes EntityVersion row.
   c. Writes AuditLog row.
   d. Emits 'food-domain.recipe.created.v1' to EventOutbox (same transaction).
4. Transaction 1 commits.
5. SearchIndexWorker picks up the event (typically <100ms).
6. Worker reads the Recipe row, constructs a SearchDocument, calls searchIndex.upsert().
7. Search index commit (transaction 2).
8. Worker emits 'food-domain.search.indexed.v1' (with latency metric) to EventOutbox.
9. Document is searchable.
```

End-to-end latency from entity write to searchable: p50 ~250ms, p99 ~1s. SLO is 95% of documents searchable within 2s of the entity write.

### 9.1 Out-of-order events
The `SearchIndexWorker` is a single-consumer queue per tenant (preserves ordering). If two events arrive for the same entity out of order (e.g. due to a retry), the worker uses the entity's `version` field to discard stale events:

```typescript
async function handleEvent(event: DomainEvent) {
  const current = await searchIndex.getDocumentVersion(event.entityType, event.entityId);
  if (current && current >= event.payload.version) {
    // Stale event; skip.
    return;
  }
  await reindexEntity(event.entityType, event.entityId);
}
```

### 9.2 Failure handling
If indexing fails (e.g. search engine is down), the worker:
1. Retries with exponential backoff (M1 `@eks/common/retry`).
2. After 5 retries, moves the event to the M1 `@eks/events` DLQ.
3. Emits a `food-domain.search.indexing-failed.v1` event with the failure reason.
4. The DLQ is drained by an operator-initiated `ReindexJob` once the underlying issue is resolved.

### 9.3 Drift detection
A nightly `SearchDriftDetector` job samples 1000 entities per tenant and verifies that the search index matches the canonical entity. Drift is reported as a metric (`search.drift.{entityType}`) and alertable via the M1 `@eks/observability` stack. Drift > 0.1% triggers an automatic reindex for the affected entity type.

---

## 10. Search Latency Optimization

### 10.1 SLOs
| Operation | p50 | p99 | Notes |
|---|---|---|---|
| `search` (full-text, no facets) | 25 ms | 100 ms | |
| `search` (full-text + 3 facets) | 50 ms | 200 ms | Facet aggregation dominates. |
| `search` (fuzzy) | 60 ms | 250 ms | Trigram similarity is expensive. |
| `autocomplete` | 8 ms | 30 ms | Materialized view. |
| `facets` (no full-text) | 30 ms | 120 ms | |
| `upsert` (single document) | 5 ms | 20 ms | |
| `reindex` (1M documents) | ~25 min | ~45 min | Bulk INSERT with `ON CONFLICT`. |

### 10.2 Techniques
1. **Partial GIN indexes per locale** — `text_tsv` is indexed per locale via partial indexes (`WHERE locale = 'en'`), so a locale-scoped query touches only one index.
2. **Materialized autocomplete view** — refreshed every 5 minutes, avoiding per-query trigram computation.
3. **Facet pre-aggregation** — for high-cardinality facets (e.g. `cookProfileId`), the worker maintains a denormalized `cookProfileLabel` column to avoid joins at query time.
4. **Result caching** — common queries (e.g. "jollof rice" in west-african cuisine) are cached in the M1 `@eks/cache` with a 60-second TTL.
5. **Connection pooling** — the `SearchIndex` uses a dedicated Prisma client with a 20-connection pool, isolated from the canonical-entity client.
6. **Read replicas** — search queries can be routed to a Postgres read replica to offload the primary.

### 10.3 Query optimization tips
- **Always pass `entityTypes`** — narrows the search to one partition.
- **Avoid `locale: "*"`** unless truly needed — it touches every locale index.
- **Use `cursor` for deep pagination** — `page > 10` is slower than cursor-based.
- **Don't combine fuzzy + facets** — fuzzy is expensive; combine with facets only when necessary.
- **Limit `facets` to 5 per query** — each additional facet adds an aggregation pass.

---

## 11. Per-Entity Indexing Notes

| Entity | Special indexing rules |
|---|---|
| `Country`, `Region`, `City`, `Neighborhood` | Indexed with `organizationId = null`. Searchable from any tenant. |
| `Ingredient` | Indexed with `organizationId = null` for global ingredients. Tenant-specific `IngredientTenantExtension` rows are indexed with the tenant's `organizationId`. The two are merged at query time via a UNION. |
| `Recipe` | `text.en.title` is the primary searchable field; `text.en.description` is secondary. The `cuisine` and `course` facets are pre-extracted for filtering. |
| `MenuItem` | Indexed with the parent `Menu`'s `organizationId`. The `cookProfileId` facet is denormalized from the `produces` / `works_at` graph traversal at index time (re-computed when the graph changes). |
| `CookProfile` | `text.en.displayName` is primary. The `cuisines` facet is a multi-value field. `ratingAverage` is a numeric sort field. |
| `CustomerProfile` | Indexed only for tenant-internal admin search (not exposed to other tenants). PII fields (`email`, `phone`) are NOT indexed; only `displayName` and `metadata.searchable.*` are. |
| `InventoryBatch` | Indexed with `batchCode` as primary text. The `ingredientId` and `kitchenId` facets support "find all batches of tomato in kitchen X". |
| `Certification`, `Inspection` | Indexed for admin search. `subjectType` and `subjectId` are facets. |
| `FoodSafetyIncident` | Indexed for admin and compliance search. `severity` and `state` are facets. |
| `NutritionProfile` | NOT directly indexed (it's a sub-document of `Ingredient` / `Recipe` / `MenuItem`). Its fields are denormalized into the parent's `metadata.nutrition.{field}`. |

---

## 12. Security & Privacy

### 12.1 PII handling
PII fields (`CustomerProfile.email`, `CustomerProfile.phone`, `User.email`, etc.) are **never** indexed. The `SearchDocument` schema explicitly excludes them. Tenant configurations that attempt to index PII are rejected at the `TenantConfiguration` validation layer.

### 12.2 Tenant isolation
Every `SearchDocument` carries `organizationId`. Every `SearchQuery` is auto-scoped to the caller's `organizationId` by the `SearchClient` wrapper:

```typescript
const search = new SearchClient(searchIndex, { organizationId: 'org-123' });
// All subsequent calls are scoped to org-123.
```

A query that attempts to override the scope (e.g. by passing a different `organizationId` in the query body) is rejected with a `TenantIsolationError`.

### 12.3 Audit
Every search query is logged to the M2 `AuditLog` with `action = 'food-domain.search.query'`, `entityTypes`, `query` (truncated to 200 chars), `resultCount`, and `tookMs`. The audit log is queryable but immutable.

### 12.4 GDPR / data subject requests
A data subject request for erasure (GDPR "right to be forgotten") triggers:
1. Soft-delete the canonical `CustomerProfile` row.
2. The `food-domain.customer.deleted.v1` event triggers `searchIndex.delete('CustomerProfile', id)`.
3. The customer's reviews, favorites, and other UGC are similarly soft-deleted and de-indexed.
4. The customer's `metadata` is wiped from the `AuditLog` (the audit log retains the action but redacts the payload).

---

## 13. See Also

- `DOMAIN_MODEL_REFERENCE.md` — entities being indexed.
- `API_DOCUMENTATION.md` §12 — search REST routes.
- `GRAPH_QUERY_GUIDE.md` — graph traversal as a complement to search.
- `OPERATIONAL_RUNBOOKS.md` §4 — search latency SLOs and drift monitoring.
- `CANONICAL_DATA_STANDARDS.md` §7 — localization model.
- `docs/identity/AUDIT_AND_COMPLIANCE.md` — audit log and GDPR.
- `docs/identity/MULTI_TENANCY.md` — tenant isolation model.
- `docs/EVENT_CONVENTIONS.md` — event envelope for indexing triggers.
