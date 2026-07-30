# Eks-Food Food Intelligence Platform — Measurement System Guide

> **Audience:** Recipe authors, kitchen operators, platform engineers, data integrators. Read alongside `CATALOG_ARCHITECTURE.md`, `RECIPE_ENGINE_GUIDE.md`, `NUTRITION_ENGINE_GUIDE.md`, and `IMPORT_EXPORT_GUIDE.md`.
>
> **Status:** Milestone 7. This document specifies the `@eks/fims` measurement system: `MeasurementUnit` and `ConversionRule` Prisma models, the `MeasurementConverter` engine, density-aware conversions (1 cup water = 240 g, 1 cup oil = 220 g), ingredient-specific conversions, localized units, and the metric ↔ imperial bridge.

---

## 1. Goals & Non-Goals

### 1.1 Goals

- One canonical measurement system used by every subsystem: catalog, recipe, inventory, nutrition, import/export.
- Volume-to-weight conversions are density-aware: the same volume unit converts to different weights depending on the ingredient.
- Every conversion is **deterministic and invertible** — converting `(5, cup, water)` → grams, then back to cups, returns `5` (within rounding tolerance).
- Localized units (e.g. the Ghanaian "olonka", the "margarine tub", the "tomato tin") are first-class — recipe authors can write quantities in local units and the system stores both the local value and the canonical conversion.
- Imperial ↔ metric conversion is exact, not approximate (1 lb = 453.59237 g exactly).
- The system is extensible: tenants can register their own units and conversion rules without schema migration.

### 1.2 Non-Goals

- Real-time density measurement from sensors (we use a static density table).
- Currency conversion (lives in M1 `@eks/common/money.ts`).
- Time and temperature conversions (handled inline; this system is for mass/volume/count only).

---

## 2. Data Model

### 2.1 `MeasurementUnit`

```
model MeasurementUnit {
  id              String   @id @default(cuid())
  code            String   @unique                 // "g", "kg", "cup", "tsp", "olonka", "piece"
  name            String                            // "gram"
  nameLocalized   String   @default("{}")           // LocalizedText JSON
  unitSystem      String                            // METRIC|IMPERIAL|LOCAL|COUNT
  dimension       String                            // MASS|VOLUME|COUNT
  // For MASS/VOLUME: the conversion factor to the canonical base unit of the same dimension
  baseUnitCode    String?                           // "g" for mass, "ml" for volume, null for COUNT
  factorToBase    Float?                            // multiply by this to convert to base unit
  // Display
  symbol          String?                           // "g", "kg", "tbsp"
  decimalPlaces   Int      @default(2)              // recommended display precision
  // Lifecycle
  status          String   @default("ACTIVE")       // ACTIVE|DEPRECATED
  isTenantScoped  Boolean  @default(false)          // true for tenant-registered local units
  organizationId  String?                           // null for global units, set for tenant units
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([dimension, unitSystem])
  @@index([organizationId])
}
```

### 2.2 Canonical base units

| Dimension | Base unit | Notes |
|---|---|---|
| `MASS` | `g` (gram) | All mass quantities convert through grams. |
| `VOLUME` | `ml` (milliliter) | All volume quantities convert through milliliters. |
| `COUNT` | `piece` | Count quantities are dimensionless; conversions between count units (`piece`, `dozen`, `case`) use `factorToBase` relative to `piece`. |

### 2.3 Seeded global units (excerpt)

| Code | System | Dimension | factorToBase | Symbol |
|---|---|---|---|---|
| `g` | METRIC | MASS | 1 | g |
| `kg` | METRIC | MASS | 1000 | kg |
| `mg` | METRIC | MASS | 0.001 | mg |
| `oz` | IMPERIAL | MASS | 28.349523125 | oz |
| `lb` | IMPERIAL | MASS | 453.59237 | lb |
| `ml` | METRIC | VOLUME | 1 | ml |
| `L` | METRIC | VOLUME | 1000 | L |
| `tsp` | IMPERIAL | VOLUME | 4.92892159375 | tsp |
| `tbsp` | IMPERIAL | VOLUME | 14.78676478125 | tbsp |
| `fl_oz` | IMPERIAL | VOLUME | 29.5735295625 | fl oz |
| `cup` | IMPERIAL | VOLUME | 236.5882365 | cup (US legal = 240 ml; we use US customary) |
| `pint` | IMPERIAL | VOLUME | 473.176473 | pt |
| `quart` | IMPERIAL | VOLUME | 946.352946 | qt |
| `gallon` | IMPERIAL | VOLUME | 3785.411784 | gal |
| `piece` | COUNT | COUNT | 1 | pc |
| `dozen` | COUNT | COUNT | 12 | dz |
| `case` | COUNT | COUNT | (variable, see `ConversionRule`) | case |

### 2.4 Local units (Ghanaian / West African)

| Code | Dimension | factorToBase | Notes |
|---|---|---|---|
| `olonka` | VOLUME | ≈ 3136 ml | Tin of milk, common in Ghanaian recipes |
| `tomato_tin` | VOLUME | 400 ml | Standard 400 g tomato tin |
| `margarine_tub` | MASS | 250 g | Standard margarine tub |
| `butter_stick` | MASS | 113.4 g | 1 US butter stick = 4 oz |
| `coconut_half` | COUNT | 1 | Used in recipes calling for "half a coconut" |

These are seeded as `isTenantScoped=false, organizationId=null` (globally available). Tenants may register additional local units via `POST /api/v1/fims/units`.

### 2.5 `ConversionRule`

Density-aware and ingredient-specific conversions live here. Each rule overrides the default `factorToBase` for a specific `(fromUnit, toUnit, catalogId)` triple.

```
model ConversionRule {
  id              String   @id @default(cuid())
  fromUnitCode    String                            // FK → MeasurementUnit.code
  toUnitCode      String                            // FK → MeasurementUnit.code
  catalogId       String?                           // FK → FoodCatalog (null = applies to all)
  variantId       String?                           // FK → IngredientVariant (overrides catalogId)
  factor          Float                             // multiply by this to convert from → to
  offset          Float    @default(0)              // for affine conversions (e.g. °C → °F — not used here)
  // Source
  source          String                            // USDA|WAFCT|TENANT_MANUAL|SUPPLIER
  // Lifecycle
  status          String   @default("ACTIVE")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([fromUnitCode, toUnitCode, catalogId, variantId])
  @@index([fromUnitCode, toUnitCode])
  @@index([catalogId])
}
```

### 2.6 Example conversion rules

| fromUnit | toUnit | catalogId | factor | Meaning |
|---|---|---|---|---|
| `cup` | `g` | FC-WATER-001 | 240 | 1 cup water = 240 g |
| `cup` | `g` | FC-OIL-PALM-001 | 220 | 1 cup palm oil ≈ 220 g (density 0.92 g/ml) |
| `cup` | `g` | FC-FLOUR-WHT-001 | 125 | 1 cup all-purpose flour (scooped, leveled) |
| `cup` | `g` | FC-SUGAR-GRN-001 | 200 | 1 cup granulated sugar |
| `cup` | `g` | FC-RICE-LG-001 | 185 | 1 cup long-grain rice, raw |
| `tbsp` | `g` | FC-OIL-PALM-001 | 13.6 | 1 tbsp palm oil |
| `piece` | `g` | FC-ONION-RED-001 | 150 | average red onion weight |
| `clove` | `g` | FC-GARLIC-001 | 5 | average garlic clove |

The `MeasurementConverter` always prefers the most specific rule: `variantId` match > `catalogId` match > global default (`factorToBase` only).

---

## 3. The `MeasurementConverter` Engine

Located at `packages/fims/src/measurement/converter.ts`:

```typescript
export interface Quantity {
  value: number;
  unit: string;              // MeasurementUnit.code
  catalogId?: string;        // required for density-aware conversions
  variantId?: string;
}

export interface ConversionResult {
  value: number;
  unit: string;
  source: 'rule_variant' | 'rule_catalog' | 'rule_global' | 'default_factor';
  ruleId?: string;
}

export class MeasurementConverter {
  constructor(
    private readonly unitRepo: UnitRepository,
    private readonly ruleRepo: RuleRepository,
  ) {}

  /** Convert a quantity to a target unit. Throws on incompatible dimensions. */
  async convert(qty: Quantity, targetUnit: string): Promise<ConversionResult>;

  /** Convert to grams (used by nutrition engine). */
  async toGrams(qty: Quantity): Promise<ConversionResult>;

  /** Convert to milliliters (used for liquid inventory). */
  async toMilliliters(qty: Quantity): Promise<ConversionResult>;

  /** Find a readable unit for display (e.g. 1500 g → 1.5 kg). */
  async toReadable(qty: Quantity): Promise<ConversionResult>;

  /** List all units available in a dimension, with their factors. */
  async listUnits(dimension: 'MASS' | 'VOLUME' | 'COUNT'): Promise<MeasurementUnit[]>;

  /** Validate that a unit code exists and is ACTIVE. */
  async validateUnit(unitCode: string): Promise<boolean>;
}
```

### 3.1 Conversion algorithm

To convert `(value, fromUnit, catalogId, variantId)` → `targetUnit`:

1. Look up `fromUnit` and `targetUnit` in `MeasurementUnit`. Both must be `ACTIVE`.
2. If `fromUnit.dimension !== targetUnit.dimension`:
   - If both are `MASS` and `VOLUME` (in either order), use density-aware conversion via the canonical base (see §3.2).
   - If either is `COUNT`, throw `MeasurementIncompatibleError` (cannot convert 5 pieces to grams without a per-piece weight).
3. If dimensions match:
   - Convert `value` to base unit: `baseValue = value × fromUnit.factorToBase`.
   - Convert base to target: `result = baseValue / targetUnit.factorToBase`.
   - Source: `'default_factor'`.
4. Return `{ value: result, unit: targetUnit, source }`.

### 3.2 Density-aware conversion (MASS ↔ VOLUME)

To convert volume → mass for ingredient `catalogId`:

1. Find the most specific `ConversionRule` where `fromUnitCode = fromUnit`, `toUnitCode = targetUnit`, and `(catalogId, variantId)` matches with the priority order above.
2. If a rule exists: `result = value × rule.factor`. Source: `'rule_variant'` or `'rule_catalog'`.
3. If no rule exists, look up `FoodCatalog.metadata.density` (g/ml). If present:
   - Convert `value` from `fromUnit` to ml using `factorToBase`.
   - `result = mlValue × density`.
   - Source: `'rule_global'` (synthesized).
4. If no density either:
   - Default to water density (1.0 g/ml).
   - Emit a `measurement.density.assumed` warning via the M1 `@eks/observability` logger.
   - Source: `'default_factor'`.

### 3.3 Invertibility

Every conversion is invertible. The converter guarantees that for any `qty` and `targetUnit`:

```
convert(convert(qty, targetUnit), qty.unit).value ≈ qty.value
```

within floating-point tolerance (10⁻⁶). Tests in `packages/fims/__tests__/measurement-roundtrip.spec.ts` verify this for every seeded unit pair × 10 ingredient fixtures.

### 3.4 Readable unit selection

`toReadable(qty)` chooses a display-friendly unit. Rules:

- For `MASS`: if value ≥ 1000 g, convert to kg; if value < 1 g, convert to mg; else keep g.
- For `VOLUME`: if value ≥ 1000 ml, convert to L; else keep ml.
- For `COUNT`: keep the original unit.
- For local units: if the original quantity was authored in a local unit, return it as-is (don't auto-convert).

This is used by the recipe scaler output (see `RECIPE_ENGINE_GUIDE.md` §5.4 rounding) and by the cook workspace UI.

---

## 4. Localized Units

### 4.1 Display names

Each `MeasurementUnit` has `nameLocalized` (LocalizedText JSON). Example for `cup`:

```json
{
  "en": "cup",
  "fr": "tasse",
  "tw": "kuruwa",
  "ha": "kofa",
  "yor": "igò"
}
```

The API accepts `?locale=tw` and returns the localized name. The unit code (`cup`) is locale-independent — only the display name changes.

### 4.2 Locale-aware preferred units

Tenants configure their preferred unit system per locale:

```typescript
type TenantUnitPreferences = {
  defaultMassUnit: 'g' | 'oz' | 'lb';
  defaultVolumeUnit: 'ml' | 'L' | 'cup' | 'tbsp';
  defaultCountUnit: 'piece' | 'dozen';
  localeSpecific: {
    'en-GH': { mass: 'g', volume: 'ml', count: 'piece' },
    'en-US': { mass: 'oz', volume: 'cup', count: 'piece' },
    'fr':    { mass: 'g', volume: 'ml', count: 'piece' },
  };
};
```

When the cook workspace renders a recipe, the scaler's `options.preferredUnitSystem` is derived from the cook's locale → `TenantUnitPreferences`. Quantities are converted to the preferred units for display; the underlying stored value remains canonical.

### 4.3 Recipe authoring in local units

A recipe author in Accra may write "2 olonka of rice". The authoring UI:

1. Stores `RecipeIngredientLine.quantity = 2, unit = 'olonka'`.
2. Immediately calls `MeasurementConverter.toGrams({ value: 2, unit: 'olonka', catalogId: 'FC-RICE-LG-001' })` to compute the gram equivalent.
3. Stores the gram equivalent in `RecipeIngredientLine.metadata.canonicalGrams = 6272` (2 × 3136 ml × ~1.0 g/ml density for rice, or via the `olonka → g` rule for rice if one exists).
4. Displays "2 olonka (≈ 6.27 kg)" in the recipe.

This dual storage means the recipe is usable by cooks in any locale: a US cook sees "13.83 lb" via imperial conversion.

---

## 5. Volume vs Weight: Why Density Matters

### 5.1 The classic error

A naive conversion treats `1 cup = 240 g` for all ingredients. This is correct for water but wrong for nearly everything else:

| Ingredient | 1 cup volume (ml) | 1 cup mass (g) | Density (g/ml) |
|---|---|---|---|
| Water | 240 | 240 | 1.00 |
| Palm oil | 240 | 220 | 0.92 |
| All-purpose flour | 240 | 125 | 0.52 |
| Granulated sugar | 240 | 200 | 0.83 |
| Honey | 240 | 340 | 1.42 |
| Long-grain rice | 240 | 185 | 0.77 |

A recipe that calls for "1 cup flour" and is converted to grams as 240 g will be ~92% over-weighted — a disaster for baking.

### 5.2 How the converter prevents this

Every volume → mass conversion in the recipe scaler and nutrition engine passes through `MeasurementConverter.toGrams()`, which uses the density-aware algorithm in §3.2. If no rule and no density are present, the converter:

1. Refuses the conversion (returns `ConversionResult.source = 'default_factor'` with a warning).
2. The recipe publish step rejects the recipe with `422 fims.recipe.publish.conversion.missing` listing the offending ingredient lines.

This forces the recipe author (or the catalog manager) to either:
- Set `FoodCatalog.metadata.density` for the ingredient, OR
- Add a `ConversionRule` row for `(cup, g, catalogId)`.

### 5.3 Density sources

The seeded densities come from:

- **USDA SR Legacy** (≈ 7 000 ingredients with density data).
- **WAFCT 2019** (West African ingredients not in USDA).
- **Supplier-provided** (for tenant-specific products).

Densities are stored as a JSON object on `FoodCatalog.metadata.density`:

```json
{ "value": 0.92, "unit": "g/ml", "source": "WAFCT", "temperatureC": 20 }
```

---

## 6. API Surface

All routes under `/api/v1/fims/units/*` and `/api/v1/fims/conversions/*`.

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `GET` | `/api/v1/fims/units` | List (filter by `dimension`, `unitSystem`, `status`) | `food.unit.read` |
| `GET` | `/api/v1/fims/units/{code}` | Get one | `food.unit.read` |
| `POST` | `/api/v1/fims/units` | Create tenant unit (`isTenantScoped=true`) | `food.unit.create` |
| `PATCH` | `/api/v1/fims/units/{code}` | Update (only display fields; factorToBase immutable post-create) | `food.unit.update` |
| `POST` | `/api/v1/fims/units/{code}/deprecate` | Deprecate | `food.unit.deprecate` |
| `GET` | `/api/v1/fims/conversions` | List conversion rules (filter by `catalogId`, `fromUnitCode`, `toUnitCode`) | `food.unit.read` |
| `POST` | `/api/v1/fims/conversions` | Create rule | `food.conversion.create` |
| `PATCH` | `/api/v1/fims/conversions/{id}` | Update factor | `food.conversion.update` |
| `DELETE` | `/api/v1/fims/conversions/{id}` | Delete (hard delete — rules are not soft-deleted because they're not audit-relevant) | `food.conversion.delete` |
| `POST` | `/api/v1/fims/conversions/convert` | One-shot conversion | `food.unit.read` |
| `POST` | `/api/v1/fims/conversions/convert-batch` | Batch conversion (up to 500 quantities) | `food.unit.read` |

### 6.1 Example: convert

```http
POST /api/v1/fims/conversions/convert HTTP/1.1
Content-Type: application/json

{
  "value": 2,
  "unit": "cup",
  "catalogId": "clx_flour",
  "targetUnit": "g"
}

HTTP/1.1 200 OK
{
  "value": 250,
  "unit": "g",
  "source": "rule_catalog",
  "ruleId": "clx_rule_001"
}
```

### 6.2 Example: batch convert

```http
POST /api/v1/fims/conversions/convert-batch HTTP/1.1
Content-Type: application/json

{
  "quantities": [
    { "value": 1, "unit": "cup", "catalogId": "clx_water",  "targetUnit": "g" },
    { "value": 1, "unit": "cup", "catalogId": "clx_oil",    "targetUnit": "g" },
    { "value": 1, "unit": "cup", "catalogId": "clx_flour",  "targetUnit": "g" },
    { "value": 1, "unit": "cup", "catalogId": "clx_sugar",  "targetUnit": "g" }
  ]
}

HTTP/1.1 200 OK
{
  "results": [
    { "value": 240, "unit": "g", "source": "rule_catalog" },
    { "value": 220, "unit": "g", "source": "rule_catalog" },
    { "value": 125, "unit": "g", "source": "rule_catalog" },
    { "value": 200, "unit": "g", "source": "rule_catalog" }
  ]
}
```

### 6.3 Error catalog

| Code | HTTP | Meaning |
|---|---|---|
| `fims.unit.not_found` | 404 | Unit code does not exist or is DEPRECATED |
| `fims.unit.incompatible_dimension` | 422 | Cannot convert between dimensions (e.g. COUNT → MASS without rule) |
| `fims.conversion.no_rule` | 422 | No rule and no density; caller must provide one |
| `fims.unit.tenant_scoped.mismatch` | 403 | Caller is in a different tenant than the unit's `organizationId` |
| `fims.unit.factor_to_base.immutable` | 422 | Attempted to change `factorToBase` after creation |
| `fims.conversion.cycle` | 422 | Rule would create a non-invertible cycle |

---

## 7. Caching

Conversion rules and unit definitions are read-heavy and rarely change. The `MeasurementConverter` caches:

- **Unit table**: in-process LRU, 1 000 entries, TTL 1 hour. Invalidated on `POST/PATCH/DELETE /units`.
- **Rule lookup**: in-process LRU keyed `(fromUnit, toUnit, catalogId, variantId)`, 10 000 entries, TTL 1 hour. Invalidated on `POST/PATCH/DELETE /conversions`.
- **Density lookup**: cache on `catalogId`, TTL 5 minutes (densities can be updated; longer cache risks stale reads).

Cache miss → DB read → populate cache → return. Cache hit latency: < 0.1 ms.

---

## 8. Recipe Scaler Integration

The `RecipeScaler` (see `RECIPE_ENGINE_GUIDE.md` §5) uses the converter to:

1. Convert every `RecipeIngredientLine.quantity × unit` to grams for inventory reservation (inventory stock is stored in canonical units per `InventoryStock.unit`).
2. Convert the scaled gram quantity back to the cook's preferred display unit (`options.preferredUnitSystem`).
3. Apply rounding rules per the display unit (see `RECIPE_ENGINE_GUIDE.md` §5.4).
4. Pass the gram quantity to the `NutritionEngine` for nutrition roll-up.

This means: even if a recipe is authored in imperial units, scaled for 500 servings, and displayed to a metric cook, the underlying reservation and nutrition math is always in grams — eliminating unit-mismatch bugs.

---

## 9. References

- `CATALOG_ARCHITECTURE.md` — `FoodCatalog.metadata.density`, `IngredientVariant.packUnit`.
- `RECIPE_ENGINE_GUIDE.md` — `RecipeScaler`'s use of the converter.
- `NUTRITION_ENGINE_GUIDE.md` — `NutritionEngine.computeForIngredientLine` uses `toGrams`.
- `INVENTORY_GUIDE.md` — `InventoryStock.unit` references `MeasurementUnit.code`.
- `IMPORT_EXPORT_GUIDE.md` — unit validation during catalog import.
- M6 `docs/food-domain/CANONICAL_DATA_STANDARDS.md` — `LocalizedText` shape.
- M1 `docs/CODING_STANDARDS.md`, `docs/API_CONVENTIONS.md`.
