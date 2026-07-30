# Eks-Food Connector Transformation Guide

> **Audience:** Connector authors, integration architects, data engineers. Read alongside `ARCHITECTURE.md` (Mapping & Transformation bounded contexts), `SCHEMA_REGISTRY_GUIDE.md` (how templates reference schema versions), `CONNECTOR_DEVELOPMENT.md` §3.8 (the `mapSchema()` method), and the M3 `docs/developer/CONNECTOR_SDK_GUIDE.md` §5 (the `mapSchema` helper from `@eks/connector-sdk/schema-mapper`).
>
> **Status:** M4. The transformation engine lives in `@eks/integration/transformation.ts`. State is persisted in `MappingTemplate` (one row per source→target mapping definition) and `TransformationRule` (one row per reusable transformation). The engine supports JSON, XML, and CSV inputs; declarative rules for object mapping, calculated fields, lookup tables, and conditional logic; and a plugin host for custom transformations.

---

## 1. The Transformation Pipeline

Every external record flows through the same pipeline before being emitted as a domain event:

```
   ┌──────────────┐
   │  Raw record  │  (JSON from REST/GraphQL; XML from SOAP; CSV row from SFTP)
   └──────┬───────┘
          │
          ▼
   ┌──────────────────────────────────┐
   │  1. Format normalisation         │  (XML → JSON via fast-xml-parser; CSV → JSON via papaparse)
   └──────┬───────────────────────────┘
          │
          ▼
   ┌──────────────────────────────────┐
   │  2. MappingTemplate application  │  (source → target field projection; uses mapSchema from @eks/connector-sdk)
   └──────┬───────────────────────────┘
          │
          ▼
   ┌──────────────────────────────────┐
   │  3. TransformationRule chain     │  (calculated fields, lookup tables, conditional logic, custom plugins)
   └──────┬───────────────────────────┘
          │
          ▼
   ┌──────────────────────────────────┐
   │  4. Schema validation            │  (validate against target SchemaVersion; raise CONN_SCHEMA_MISMATCH on failure)
   └──────┬───────────────────────────┘
          │
          ▼
   ┌──────────────┐
   │  Mapped      │  (ready to emit as a domain event)
   │  record      │
   └──────────────┘
```

Steps 1 and 4 are platform-level (the connector author does not implement them). Steps 2 and 3 are declarative — defined by `MappingTemplate` and `TransformationRule` rows that the operator can edit without a code release. The connector's `mapSchema()` method (step 2's fallback when no `MappingTemplate` exists) is the code-level escape hatch.

---

## 2. The `MappingTemplate` and `TransformationRule` Models

### 2.1 `MappingTemplate`

```prisma
model MappingTemplate {
  id              String   @id @default(cuid())
  organizationId  String?  // null for platform-owned templates
  // The connector that owns this template (null for platform-shared templates)
  connectorCode   String?
  name            String   // e.g. "order-to-booking"
  description     String?
  // The source schema reference (JSON: { name, versionRange })
  sourceSchema    String   // e.g. {"name":"acme-order","versionRange":"^1.4.0"}
  // The target schema reference (JSON: { name, versionRange })
  targetSchema    String   // e.g. {"name":"eks-booking","versionRange":"^1.2.0"}
  // The mapping rules (JSON array of { source, target, transform, required })
  rules           String   // JSON
  // The transformation rule IDs to apply after mapping (JSON array, in order)
  transformationRuleIds String @default("[]")
  // The version of this template (semver)
  version         String   @default("1.0.0")
  active          Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([organizationId, connectorCode, name, version])
  @@index([organizationId, active])
}
```

### 2.2 `TransformationRule`

```prisma
model TransformationRule {
  id              String   @id @default(cuid())
  organizationId  String?  // null for platform-owned rules
  name            String   // e.g. "toMoneyGHS", "acmeRegionToEksRegion"
  description     String?
  // The kind of transformation: BUILTIN | LOOKUP_TABLE | CALCULATED | CONDITIONAL | CUSTOM_PLUGIN
  kind            String
  // The transformation definition (JSON; shape depends on kind)
  definition      String   // JSON
  // The input type (JSON Schema fragment for the expected input)
  inputType       String   @default("{}")
  // The output type (JSON Schema fragment for the produced output)
  outputType      String   @default("{}")
  // The version (semver)
  version         String   @default("1.0.0")
  active          Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([organizationId, name, version])
  @@index([organizationId, active])
}
```

The five `kind` values:

| Kind | Use case | Definition shape |
|---|---|---|
| `BUILTIN` | Platform-provided transforms (toISO, toMoney, toString, toInt, ...) | `{ "function": "toISO" }` |
| `LOOKUP_TABLE` | Static key→value mapping (region IDs, currency codes, category mappings) | `{ "table": { "acme-r1": "r-accra", ... }, "default": "r-accra" }` |
| `CALCULATED` | Computed field (arithmetic, string concat, date math) | `{ "expression": "total_cents / 100", "language": "jmespath" }` |
| `CONDITIONAL` | If/then/else logic | `{ "if": "record.status == 'CONFIRMED'", "then": ..., "else": ... }` |
| `CUSTOM_PLUGIN` | Connector-supplied plugin | `{ "pluginPath": "./transformations/price-rounding.js", "function": "roundPrice" }` |

---

## 3. Format Normalisation

### 3.1 JSON (default)

JSON records pass through step 1 unchanged. The runtime assumes UTF-8 encoding; non-UTF-8 payloads are rejected at the egress proxy with `415 Unsupported Media Type`.

### 3.2 XML

XML records (from SOAP services or legacy file feeds) are normalised to JSON via `fast-xml-parser` with the platform's standard options:

```typescript
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => XML_ARRAY_FIELDS.has(name),  // declared in the MappingTemplate
  parseTagValue: true,
  trimValues: true,
});

const json = parser.parse(xmlString);
```

The `XML_ARRAY_FIELDS` set is declared in the `MappingTemplate` (under `xmlConfig.arrayFields`) because XML does not distinguish single-element arrays from objects — the connector author must declare which fields are always arrays.

### 3.3 CSV

CSV records (from SFTP file imports or bulk uploads) are normalised to JSON via `papaparse`:

```typescript
import Papa from "papaparse";

const result = Papa.parse(csvString, {
  header: true,
  dynamicTyping: true,
  skipEmptyLines: true,
  transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
});

const records = result.data;  // array of { col1: value1, col2: value2, ... }
```

The connector declares `csvConfig` in the `MappingTemplate`:
- `delimiter` — default auto-detect
- `header` — default `true`
- `dynamicTyping` — default `true`
- `transformHeader` — default lowercase-snake-case

The runtime emits one `MappingTemplate` application per CSV row, so the rest of the pipeline is identical to JSON.

---

## 4. Object Mapping (Step 2)

The `MappingTemplate.rules` are applied by the M3 `mapSchema` helper (`@eks/connector-sdk/schema-mapper`):

```typescript
import { mapSchema, type SchemaMappingRule } from "@eks/connector-sdk";

const rules: readonly SchemaMappingRule[] = [
  { source: "id", target: "externalId", required: true },
  { source: "customer.name", target: "customerName", required: true },
  { source: "customer.phone", target: "customerPhone" },
  { source: "items", target: "lineItems", transform: mapLineItems },
  { source: "total_cents", target: "totalAmount", transform: toMoneyGHS },
  { source: "region_id", target: "regionId", transform: acmeRegionToEksRegion, required: true },
  { source: "created_at", target: "placedAt", transform: toISO, required: true },
];

const target = mapSchema(sourceRecord, rules);
```

Each rule has:
- `source` — dot-notation path in the source record (e.g. `customer.name`). `undefined`/`null` values are skipped unless `required: true`.
- `target` — dot-notation path in the target record. Intermediate objects are created automatically.
- `transform` — optional function `(value) => unknown`. Applied to the source value before assignment.
- `required` — if `true` and the source value is missing, the mapping throws (caught by the runtime and counted in `SynchronizationJob.errors`).

For declarative templates (the JSON form in `MappingTemplate.rules`), the `transform` field is a string naming a registered transformation (e.g. `"toMoneyGHS"`, `"acmeRegionToEksRegion"`). The runtime resolves the name to a `TransformationRule` row and invokes its `definition`.

### 4.1 Worked example — flat object mapping

Source (Acme order JSON):

```json
{
  "id": "o1",
  "customer": { "name": "Amara", "phone": "+233244555666" },
  "total_cents": 12800,
  "region_id": "acme-r1",
  "created_at": "2025-01-15T10:00:00Z"
}
```

Target (Eks-Food booking):

```json
{
  "externalId": "o1",
  "customerName": "Amara",
  "customerPhone": "+233244555666",
  "totalAmount": { "amount": 12800, "currency": "GHS" },
  "regionId": "r-accra",
  "placedAt": "2025-01-15T10:00:00.000Z"
}
```

The rules above produce exactly this target. Note that `total_cents` (an integer) is transformed to `{ amount, currency }` (a `Money` object per the M3 `@eks/domain/shared/value-objects`); `region_id` is looked up in a static table; `created_at` is re-formatted as an ISO string with milliseconds.

### 4.2 Worked example — array mapping

Source:

```json
{
  "items": [
    { "sku": "jollof", "name": "Jollof Rice", "qty": 2, "unit_price_cents": 3200 },
    { "sku": "fufu", "name": "Fufu", "qty": 1, "unit_price_cents": 2800 }
  ]
}
```

Target:

```json
{
  "lineItems": [
    { "sku": "jollof", "name": "Jollof Rice", "quantity": 2, "unitPriceCents": 3200 },
    { "sku": "fufu", "name": "Fufu", "quantity": 1, "unitPriceCents": 2800 }
  ]
}
```

The transform function:

```typescript
function mapLineItems(items: unknown) {
  if (!Array.isArray(items)) return [];
  return items.map((i) => ({
    sku: i.sku,
    name: i.name,
    quantity: i.qty,
    unitPriceCents: i.unit_price_cents,
  }));
}
```

---

## 5. Transformation Rules (Step 3)

After mapping, the runtime applies the `transformationRuleIds` chain. Each rule is a `TransformationRule` row; the chain is applied in order, and each rule receives the output of the previous rule as its input.

### 5.1 Builtin transformations

The platform provides a small library of built-in functions:

| Function | Input | Output | Example |
|---|---|---|---|
| `toISO` | string \| Date | string (ISO 8601) | `"2025-01-15T10:00:00Z"` → `"2025-01-15T10:00:00.000Z"` |
| `toISODate` | string \| Date | string (YYYY-MM-DD) | `"2025-01-15T10:00:00Z"` → `"2025-01-15"` |
| `toString` | any | string | `128` → `"128"` |
| `toInt` | string \| number | number | `"128"` → `128` |
| `toFloat` | string \| number | number | `"12.80"` → `12.8` |
| `toBool` | string \| number \| boolean | boolean | `"true"` → `true`, `1` → `true`, `0` → `false` |
| `toMoney` | number \| { amount, currency } | { amount, currency } | `12800` → `{ amount: 12800, currency: "GHS" }` |
| `toMoneyGHS` | number | { amount, currency: "GHS" } | `12800` → `{ amount: 12800, currency: "GHS" }` |
| `toUpperCase` | string | string | `"accra"` → `"ACCRA"` |
| `toLowerCase` | string | string | `"ACCRA"` → `"accra"` |
| `trim` | string | string | `" accra "` → `"accra"` |
| `format` | (string, args) | string | `"Hello {0}"`, `["Amara"]` → `"Hello Amara"` |
| `now` | void | string (ISO 8601) | → `"2025-01-15T10:00:00.000Z"` |
| `uuid` | void | string (UUIDv4) | → `"c5b8b1f0-..."` |

A `MappingTemplate.rule` references a builtin by name:

```json
{ "source": "total_cents", "target": "totalAmount", "transform": "toMoneyGHS", "required": true }
```

### 5.2 Lookup tables

A `LOOKUP_TABLE` rule maps a set of input values to output values:

```json
{
  "name": "acmeRegionToEksRegion",
  "kind": "LOOKUP_TABLE",
  "definition": {
    "table": {
      "acme-r1": "r-accra",
      "acme-r2": "r-kumasi",
      "acme-r3": "r-takoradi",
      "acme-r4": "r-tamale"
    },
    "default": "r-accra",
    "strict": false
  },
  "inputType": { "type": "string" },
  "outputType": { "type": "string" }
}
```

- `table` — the lookup map.
- `default` — the value to return if the input is not in `table` (required if `strict=false`).
- `strict` — if `true`, an unknown input throws (caught by the runtime and counted in `SynchronizationJob.errors`). If `false`, the `default` is returned.

Lookup tables are editable by operators (via `PATCH /api/v1/integrations/transformations/:id`) without a code release. This is the most common edit: when a new region is added to Acme, the operator adds the mapping without redeploying the connector.

### 5.3 Calculated fields

A `CALCULATED` rule computes a value from the record using a JMESPath expression:

```json
{
  "name": "totalAmountFromItems",
  "kind": "CALCULATED",
  "definition": {
    "expression": "sum(lineItems[].quantity * lineItems[].unitPriceCents)",
    "language": "jmespath",
    "target": "calculatedTotalCents"
  },
  "inputType": { "type": "object", "properties": { "lineItems": { "type": "array" } } },
  "outputType": { "type": "integer" }
}
```

The `expression` is evaluated against the record (post-mapping); the result is written to `target` on the record. Supported languages:
- `jmespath` (default) — JMESPath expressions.
- `jsonata` — JSONata expressions (more powerful; supports conditionals and functions).
- `expr-eval` — pure arithmetic expressions (e.g. `a + b * c`).

The platform caches the compiled expression (JMESPath and JSONata compile to a closure) for the lifetime of the `MappingTemplate` version.

### 5.4 Conditional logic

A `CONDITIONAL` rule applies different transforms based on a predicate:

```json
{
  "name": "statusMapping",
  "kind": "CONDITIONAL",
  "definition": {
    "if": "status == 'CONFIRMED'",
    "then": { "set": { "bookingStatus": "CONFIRMED" } },
    "elseIf": [
      { "if": "status == 'CANCELLED'", "then": { "set": { "bookingStatus": "CANCELLED" } } },
      { "if": "status == 'PENDING'", "then": { "set": { "bookingStatus": "PENDING" } } }
    ],
    "else": { "throw": "unknown_status" }
  },
  "inputType": { "type": "object", "properties": { "status": { "type": "string" } } },
  "outputType": { "type": "object", "properties": { "bookingStatus": { "type": "string" } } }
}
```

The `if`/`elseIf` predicates use JMESPath boolean expressions. The `then`/`else` actions:
- `set` — set a field on the record.
- `delete` — delete a field from the record.
- `transform` — apply a named transformation.
- `throw` — raise an error (caught by the runtime, counted in `SynchronizationJob.errors`).

### 5.5 Custom transformation plugins

A `CUSTOM_PLUGIN` rule delegates to a connector-supplied function:

```json
{
  "name": "priceRounding",
  "kind": "CUSTOM_PLUGIN",
  "definition": {
    "pluginPath": "./transformations/price-rounding.js",
    "function": "roundPrice"
  },
  "inputType": { "type": "object", "properties": { "totalAmount": { "type": "object" } } },
  "outputType": { "type": "object", "properties": { "totalAmount": { "type": "object" } } }
}
```

The plugin file (inside the connector bundle):

```typescript
// transformations/price-rounding.js
export function roundPrice(record: { totalAmount: { amount: number; currency: string } }) {
  // Round to the nearest 100 pesewas (1 GHS = 100 pesewas) — cash-friendly rounding.
  const rounded = Math.round(record.totalAmount.amount / 100) * 100;
  return { ...record, totalAmount: { ...record.totalAmount, amount: rounded } };
}
```

The runtime loads the plugin from the connector bundle inside the sandbox; the function receives the record and returns the transformed record. Custom plugins are subject to platform review at publish time (the M3 validation pipeline flags `kind=CUSTOM_PLUGIN` for human review).

---

## 6. Worked Example — End-to-End Transformation

This section traces a single Acme order through the full pipeline.

### 6.1 The source record

```json
{
  "id": "o1",
  "customer": { "name": "Amara", "phone": "+233244555666" },
  "items": [
    { "sku": "jollof", "name": "Jollof Rice", "qty": 2, "unit_price_cents": 3200 },
    { "sku": "fufu", "name": "Fufu", "qty": 1, "unit_price_cents": 2800 }
  ],
  "total_cents": 9200,
  "region_id": "acme-r1",
  "status": "CONFIRMED",
  "created_at": "2025-01-15T10:00:00Z"
}
```

### 6.2 Step 1 — Format normalisation

The record is already JSON; no normalisation needed.

### 6.3 Step 2 — MappingTemplate application

`MappingTemplate` `order-to-booking` v1.2.0, rules:

```json
[
  { "source": "id", "target": "externalId", "required": true },
  { "source": "customer.name", "target": "customerName", "required": true },
  { "source": "customer.phone", "target": "customerPhone" },
  { "source": "items", "target": "lineItems", "transform": "mapLineItems" },
  { "source": "total_cents", "target": "totalAmount", "transform": "toMoneyGHS", "required": true },
  { "source": "region_id", "target": "regionId", "transform": "acmeRegionToEksRegion", "required": true },
  { "source": "status", "target": "rawStatus", "required": true },
  { "source": "created_at", "target": "placedAt", "transform": "toISO", "required": true }
]
```

After mapping:

```json
{
  "externalId": "o1",
  "customerName": "Amara",
  "customerPhone": "+233244555666",
  "lineItems": [
    { "sku": "jollof", "name": "Jollof Rice", "quantity": 2, "unitPriceCents": 3200 },
    { "sku": "fufu", "name": "Fufu", "quantity": 1, "unitPriceCents": 2800 }
  ],
  "totalAmount": { "amount": 9200, "currency": "GHS" },
  "regionId": "r-accra",
  "rawStatus": "CONFIRMED",
  "placedAt": "2025-01-15T10:00:00.000Z"
}
```

### 6.4 Step 3 — TransformationRule chain

`transformationRuleIds: ["tr_status_mapping", "tr_price_rounding"]`.

#### 6.4.1 `tr_status_mapping` (CONDITIONAL)

```json
{
  "if": "rawStatus == 'CONFIRMED'",
  "then": { "set": { "bookingStatus": "CONFIRMED" } },
  "else": { "throw": "unknown_status" }
}
```

After applying:

```json
{
  ...,
  "bookingStatus": "CONFIRMED"
}
```

(The `rawStatus` field is kept; the platform's `targetSchema` declares it as optional and ignores it for aggregate construction.)

#### 6.4.2 `tr_price_rounding` (CUSTOM_PLUGIN)

```typescript
function roundPrice(record) {
  const rounded = Math.round(record.totalAmount.amount / 100) * 100;
  return { ...record, totalAmount: { ...record.totalAmount, amount: rounded } };
}
```

After applying:

```json
{
  ...,
  "totalAmount": { "amount": 9200, "currency": "GHS" }  // already a multiple of 100; no change
}
```

### 6.5 Step 4 — Schema validation

The runtime validates the record against `eks-booking@1.2.3`'s JSON Schema. The schema requires `externalId`, `customerName`, `totalAmount.amount`, `totalAmount.currency`, `regionId`, `bookingStatus`, `placedAt` — all present and correctly typed. Validation passes.

### 6.6 The mapped record is emitted

```typescript
await ctx.sdk.events.publish("acme.order.updated.v1", mappedRecord, {
  dedupeKey: `acme-order-${mappedRecord.externalId}`,
});
```

The M3 `@eks/domain/contexts/booking` handler applies the event to the `Booking` aggregate.

---

## 7. Transformation API Reference

```
# MappingTemplate management
GET    /api/v1/integrations/mappings                          — list (filter by source/target schema, connectorCode)
POST   /api/v1/integrations/mappings                          — create
GET    /api/v1/integrations/mappings/:id                      — detail
PATCH  /api/v1/integrations/mappings/:id                      — update (rules, transformationRuleIds)
DELETE /api/v1/integrations/mappings/:id                      — remove
POST   /api/v1/integrations/mappings/:id/validate             — validate the rules against the resolved schemas
POST   /api/v1/integrations/mappings/:id/test                 — test with a sample record (returns the mapped output)

# TransformationRule management
GET    /api/v1/integrations/transformations                   — list (filter by kind, organizationId)
POST   /api/v1/integrations/transformations                   — create
GET    /api/v1/integrations/transformations/:id               — detail
PATCH  /api/v1/integrations/transformations/:id               — update (definition)
DELETE /api/v1/integrations/transformations/:id               — remove
POST   /api/v1/integrations/transformations/:id/test          — test with a sample input (returns the output)
```

The `/test` routes are useful for iterating on mappings without running a full sync. The Integration Console provides a side-by-side editor: source on the left, target on the right, with the rules and transformations editable inline.

---

## 8. Performance Considerations

The transformation pipeline is in the hot path of every sync. The platform optimises:

1. **Template caching** — `MappingTemplate` rows are cached in `@eks/cache` for 5 minutes. The cache key is `(organizationId, connectorCode, name, version)`; invalidation is on `PATCH`/`DELETE`.
2. **Rule caching** — `TransformationRule` rows are cached alongside the template; the compiled JMESPath/JSONata expressions are cached for the lifetime of the cached template.
3. **Batching** — The runtime applies the pipeline to a batch of records in a single `ConnectorRunner.execute` call, amortising the template/rule lookup cost.
4. **Compiled schemas** — The Ajv validator for the target `SchemaVersion` is compiled once per template version and cached.

Typical performance:
- Single-record pipeline: ~1ms (mapping) + ~0.5ms (transformations) + ~0.5ms (validation) = ~2ms.
- 1000-record sync: ~2s for the pipeline, plus the upstream API round-trips (typically the dominant cost).

If a connector's pipeline exceeds 5ms per record, the Integration Console shows a performance warning. Common causes:
- A `CALCULATED` rule with a complex JSONata expression — refactor to a `CUSTOM_PLUGIN`.
- A `LOOKUP_TABLE` with >1000 entries — move to a `CUSTOM_PLUGIN` with a `Map` lookup.
- A `CONDITIONAL` rule with >5 branches — refactor to a `LOOKUP_TABLE`.

---

## 9. Common Transformation Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Mapping a required field that the source omits | `CONN_SCHEMA_MISMATCH` on validation | Make the field optional in the template, or use a `CONDITIONAL` rule to set a default |
| Lookup table missing an entry | `strict=true` throws; sync fails | Either add the entry or set `strict=false` with a sensible `default` |
| Custom plugin mutating the input record | Side effects leak across records | Always return a new object (spread `...record`) — never mutate |
| JMESPath expression referencing a non-existent field | Returns `null`; downstream rules fail silently | Use the `??` (coalesce) operator in JSONata, or a `CONDITIONAL` rule with an `else` branch |
| XML array not declared in `xmlConfig.arrayFields` | Single-element arrays become objects; downstream rules fail | Declare every XML field that should always be an array in the template's `xmlConfig` |
| CSV header with spaces | Field names contain spaces; mapping rules reference the wrong path | Use `transformHeader: "snake_case"` (the default); explicitly map `customer_name` not `"Customer Name"` |
| Transformation chain order matters | `tr_price_rounding` before `tr_status_mapping` produces a different result | Order matters — the `transformationRuleIds` array is applied in sequence; document the expected order in the template description |
| Calculated field overflows | `total_cents * 100` overflows JS Number.MAX_SAFE_INTEGER | Use `BigInt` for monetary calculations, or `expr-eval` with the `bigint` option |

When in doubt, run `bunx @eks/dev-cli validate --transformations` — it static-analyses the connector's templates and rules for these pitfalls.
