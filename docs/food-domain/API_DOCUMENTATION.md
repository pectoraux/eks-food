# Eks-Food Canonical Domain API Reference

> **Audience:** Application developers, integration engineers, SDK consumers. Read alongside `DOMAIN_MODEL_REFERENCE.md` (entity definitions), `ENTITY_RELATIONSHIPS.md` (relationship vocabulary), `GRAPH_QUERY_GUIDE.md` (graph traversal via SDK), `docs/API_CONVENTIONS.md` (general REST conventions), `docs/identity/API_REFERENCE.md` (M2 IAM API).
>
> **Status:** Milestone 6. This document is the canonical REST reference for every route under `/api/v1/food-domain/*`. All routes are versioned (`v1`), tenant-isolated, audited, and require M2 authentication. Errors follow [RFC 7807](https://datatracker.ietf.org/doc/html/rfc7807).

---

## 1. Conventions

### 1.1 Base URL
```
https://{host}/api/v1/food-domain
```

### 1.2 Authentication
Every route requires a `Authorization: Bearer {jwt}` header (M2 access token). The token's `organizationId` claim is the tenant context. Cross-tenant requests are rejected with `403 cross-tenant-violation`.

### 1.3 Content type
Request and response bodies are `application/json`. Date fields are ISO-8601 strings with the `Z` suffix. UUIDs are strings. Money is `{ amount: "12.50", currency: "GHS" }` (amount as string to preserve precision).

### 1.4 Pagination
List endpoints accept `?page=1&pageSize=20` (default `pageSize=20`, max `pageSize=100`). The response includes:

```json
{
  "data": [ /* ... */ ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 134,
    "totalPages": 7
  }
}
```

Cursor-based pagination is available via `?cursor=...&limit=20` for high-volume endpoints (e.g. `GET /relationships`).

### 1.5 Filtering & sorting
List endpoints accept `?filter[field]=value` (exact), `?filter[field][eq]=value`, `?filter[field][in]=a,b`, `?filter[field][gte]=value` etc. Sorting via `?sort=field` or `?sort=-field` (descending).

### 1.6 Idempotency
Write endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) accept an optional `Idempotency-Key` header. Reusing a key within 24 hours returns the original response. See `docs/API_CONVENTIONS.md` §6.

### 1.7 Localization
Responses include the `Content-Language` header reflecting the locale used for `LocalizedText` fields. The locale is selected from the `Accept-Language` header, falling back to the tenant's default locale and then `"en"` (see `CANONICAL_DATA_STANDARDS.md` §7.3).

### 1.8 Rate limiting
Per-tenant rate limit: 600 requests / minute (default), configurable in `TenantConfiguration.foodDomain.rateLimit`. The response includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers. A `429 too-many-requests` is returned when the limit is exceeded.

### 1.9 Permission codes
Every route documents the required permission code (e.g. `food-domain.recipe.read`). Permissions are enforced by the M2 `requirePermission` middleware. See `CANONICAL_DATA_STANDARDS.md` §9.

---

## 2. Common Response Shapes

### 2.1 Single entity
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "organizationId": "org-123",
    "version": 3,
    "createdAt": "2024-06-01T12:34:56.000Z",
    "updatedAt": "2024-06-02T08:00:00.000Z",
    "deletedAt": null,
    "createdBy": "user-abc",
    "updatedBy": "user-def",
    "deletedBy": null,
    "state": "ACTIVE",
    "metadata": {},
    /* entity-specific fields */
  }
}
```

### 2.2 List
```json
{
  "data": [ /* entities */ ],
  "pagination": { /* ... */ }
}
```

### 2.3 Error (RFC 7807)
```json
{
  "type": "https://docs.eks-food.com/errors/state-transition",
  "title": "Invalid state transition",
  "status": 409,
  "detail": "Cannot transition from DEACTIVATED to ACTIVE without a RESTORE operation.",
  "instance": "/api/v1/food-domain/cooks/550e.../activate",
  "errorCode": "food-domain.state-transition.invalid",
  "entityType": "CookProfile",
  "entityId": "550e8400-e29b-41d4-a716-446655440000",
  "fromState": "DEACTIVATED",
  "toState": "ACTIVE",
  "traceId": "trace-xyz"
}
```

The `errorCode` is a stable machine-readable code. The `type` is a documentation URL. `traceId` correlates with M1 `@eks/observability` traces.

---

## 3. Geography Routes

### 3.1 Countries
| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/countries` | (public, tenant-shared) | List countries. Filter: `?iso2=GH`, `?active=true`. |
| `GET` | `/countries/{id}` | (public) | Get a country. |
| `POST` | `/countries` | `food-domain.country.create` | Create a country (platform admin only). |
| `PATCH` | `/countries/{id}` | `food-domain.country.update` | Update country fields. |
| `DELETE` | `/countries/{id}` | `food-domain.country.delete` | Soft-delete (sets `active=false`). |
| `GET` | `/countries/{id}/regions` | (public) | List regions in this country. |
| `GET` | `/countries/{id}/versions` | `food-domain.country.read-versions` | Version history. |

**Example — Create country:**
```http
POST /api/v1/food-domain/countries
Authorization: Bearer {jwt}
Idempotency-Key: country-gh-2024
Content-Type: application/json

{
  "iso2": "GH",
  "iso3": "GHA",
  "name": { "en": "Ghana", "fr": "Ghana" },
  "currency": "GHS",
  "phonePrefix": "+233",
  "timezone": "Africa/Accra",
  "metadata": {}
}
```

### 3.2 Regions, Cities, Neighborhoods
Identical route shape to countries, nested under their parent:
- `/regions`, `/regions/{id}`, `/regions/{id}/cities`
- `/cities`, `/cities/{id}`, `/cities/{id}/neighborhoods`
- `/neighborhoods`, `/neighborhoods/{id}`

All are tenant-shared (no `organizationId`). All support `GET`, `POST`, `PATCH`, `DELETE` with the corresponding `food-domain.{entity}.{action}` permission.

---

## 4. People & Household Routes

### 4.1 Households
| Method | Path | Permission |
|---|---|---|
| `GET` | `/households` | `food-domain.household.read` |
| `GET` | `/households/{id}` | `food-domain.household.read` |
| `POST` | `/households` | `food-domain.household.create` |
| `PATCH` | `/households/{id}` | `food-domain.household.update` |
| `DELETE` | `/households/{id}` | `food-domain.household.delete` |
| `POST` | `/households/{id}/suspend` | `food-domain.household.transition-state` |
| `POST` | `/households/{id}/dissolve` | `food-domain.household.transition-state` |
| `POST` | `/households/{id}/reinstate` | `food-domain.household.transition-state` |
| `GET` | `/households/{id}/members` | `food-domain.household.read` |
| `POST` | `/households/{id}/members` | `food-domain.household.update` |
| `DELETE` | `/households/{id}/members/{customerProfileId}` | `food-domain.household.update` |
| `GET` | `/households/{id}/versions` | `food-domain.household.read-versions` |
| `POST` | `/households/{id}/versions/{v}/restore` | `food-domain.household.restore-version` |

**Example — Add a member:**
```http
POST /api/v1/food-domain/households/550e.../members
Content-Type: application/json

{ "customerProfileId": "660e..." }
```
This creates a `member_of` `Relationship` from the `CustomerProfile` to the `Household`. If the customer was already a member of another household, the old `member_of` edge is superseded.

### 4.2 Customer Profiles
| Method | Path | Permission |
|---|---|---|
| `GET` | `/customers` | `food-domain.customer.read` |
| `GET` | `/customers/{id}` | `food-domain.customer.read` |
| `POST` | `/customers` | `food-domain.customer.create` |
| `PATCH` | `/customers/{id}` | `food-domain.customer.update` |
| `DELETE` | `/customers/{id}` | `food-domain.customer.delete` |
| `POST` | `/customers/{id}/deactivate` | `food-domain.customer.transition-state` |
| `GET` | `/customers/{id}/follows` | `food-domain.customer.read` |
| `POST` | `/customers/{id}/follows` | `food-domain.customer.update` |
| `DELETE` | `/customers/{id}/follows/{cookProfileId}` | `food-domain.customer.update` |
| `GET` | `/customers/{id}/versions` | `food-domain.customer.read-versions` |

**Example — Create customer:**
```json
{
  "userId": "user-abc",
  "displayName": "Ama Boateng",
  "preferredLanguage": "en-GH",
  "allergens": ["peanut"],
  "dietaryRestrictions": ["halal"],
  "neighborhoodId": "nbhd-123",
  "householdId": null
}
```

### 4.3 Cook Profiles
| Method | Path | Permission |
|---|---|---|
| `GET` | `/cooks` | `food-domain.cook.read` |
| `GET` | `/cooks/{id}` | `food-domain.cook.read` |
| `POST` | `/cooks` | `food-domain.cook.create` |
| `PATCH` | `/cooks/{id}` | `food-domain.cook.update` |
| `DELETE` | `/cooks/{id}` | `food-domain.cook.delete` |
| `POST` | `/cooks/{id}/activate` | `food-domain.cook.transition-state` |
| `POST` | `/cooks/{id}/suspend` | `food-domain.cook.transition-state` |
| `POST` | `/cooks/{id}/reinstate` | `food-domain.cook.transition-state` |
| `POST` | `/cooks/{id}/deactivate` | `food-domain.cook.transition-state` |
| `GET` | `/cooks/{id}/kitchens` | `food-domain.cook.read` |
| `POST` | `/cooks/{id}/kitchens` | `food-domain.cook.update` |
| `DELETE` | `/cooks/{id}/kitchens/{kitchenId}` | `food-domain.cook.update` |
| `GET` | `/cooks/{id}/certifications` | `food-domain.certification.read` |
| `GET` | `/cooks/{id}/inspections` | `food-domain.inspection.read` |
| `GET` | `/cooks/{id}/recipes` | `food-domain.recipe.read` |
| `GET` | `/cooks/{id}/followers` | `food-domain.cook.read` |
| `GET` | `/cooks/{id}/versions` | `food-domain.cook.read-versions` |
| `POST` | `/cooks/{id}/versions/{v}/restore` | `food-domain.cook.restore-version` |

---

## 5. Restaurant & Kitchen Routes

### 5.1 Restaurants
| Method | Path | Permission |
|---|---|---|
| `GET` | `/restaurants` | `food-domain.restaurant.read` |
| `GET` | `/restaurants/{id}` | `food-domain.restaurant.read` |
| `POST` | `/restaurants` | `food-domain.restaurant.create` |
| `PATCH` | `/restaurants/{id}` | `food-domain.restaurant.update` |
| `DELETE` | `/restaurants/{id}` | `food-domain.restaurant.delete` |
| `POST` | `/restaurants/{id}/activate` | `food-domain.restaurant.transition-state` |
| `POST` | `/restaurants/{id}/suspend` | `food-domain.restaurant.transition-state` |
| `POST` | `/restaurants/{id}/close` | `food-domain.restaurant.transition-state` |
| `GET` | `/restaurants/{id}/kitchens` | `food-domain.kitchen.read` |
| `POST` | `/restaurants/{id}/kitchens` | `food-domain.kitchen.create` |
| `GET` | `/restaurants/{id}/menus` | `food-domain.menu.read` |
| `GET` | `/restaurants/{id}/certifications` | `food-domain.certification.read` |
| `GET` | `/restaurants/{id}/inspections` | `food-domain.inspection.read` |
| `GET` | `/restaurants/{id}/versions` | `food-domain.restaurant.read-versions` |

### 5.2 Kitchens
| Method | Path | Permission |
|---|---|---|
| `GET` | `/kitchens` | `food-domain.kitchen.read` |
| `GET` | `/kitchens/{id}` | `food-domain.kitchen.read` |
| `POST` | `/kitchens` | `food-domain.kitchen.create` |
| `PATCH` | `/kitchens/{id}` | `food-domain.kitchen.update` |
| `DELETE` | `/kitchens/{id}` | `food-domain.kitchen.delete` |
| `POST` | `/kitchens/{id}/maintain` | `food-domain.kitchen.transition-state` |
| `POST` | `/kitchens/{id}/activate` | `food-domain.kitchen.transition-state` |
| `POST` | `/kitchens/{id}/decommission` | `food-domain.kitchen.transition-state` |
| `GET` | `/kitchens/{id}/cooks` | `food-domain.cook.read` |
| `POST` | `/kitchens/{id}/cooks` | `food-domain.cook.update` |
| `DELETE` | `/kitchens/{id}/cooks/{cookProfileId}` | `food-domain.cook.update` |
| `GET` | `/kitchens/{id}/equipment` | `food-domain.equipment.read` |
| `POST` | `/kitchens/{id}/equipment` | `food-domain.equipment.create` |
| `GET` | `/kitchens/{id}/inventory` | `food-domain.inventory.read` |
| `GET` | `/kitchens/{id}/menu-items` | `food-domain.menu.read` |
| `GET` | `/kitchens/{id}/inspections` | `food-domain.inspection.read` |
| `GET` | `/kitchens/{id}/versions` | `food-domain.kitchen.read-versions` |

---

## 6. Food Knowledge Routes

### 6.1 Ingredients
| Method | Path | Permission |
|---|---|---|
| `GET` | `/ingredients` | `food-domain.ingredient.read` |
| `GET` | `/ingredients/{id}` | `food-domain.ingredient.read` |
| `POST` | `/ingredients` | `food-domain.ingredient.create` |
| `PATCH` | `/ingredients/{id}` | `food-domain.ingredient.update` |
| `DELETE` | `/ingredients/{id}` | `food-domain.ingredient.delete` |
| `POST` | `/ingredients/{id}/deprecate` | `food-domain.ingredient.update` |
| `GET` | `/ingredients/{id}/nutrition` | `food-domain.ingredient.read` |
| `PUT` | `/ingredients/{id}/nutrition` | `food-domain.ingredient.update` |
| `GET` | `/ingredients/{id}/suppliers` | `food-domain.supplier.read` |
| `GET` | `/ingredients/{id}/substitutes` | `food-domain.ingredient.read` |
| `POST` | `/ingredients/{id}/substitutes` | `food-domain.ingredient.update` |
| `GET` | `/ingredients/{id}/recipes` | `food-domain.recipe.read` |
| `GET` | `/ingredients/{id}/versions` | `food-domain.ingredient.read-versions` |

**Example — Create ingredient:**
```json
{
  "name": { "en": "Tomato", "sw": "Nyanya", "fr": "Tomate" },
  "aliases": ["Solanum lycopersicum"],
  "category": "vegetable",
  "allergenFlags": [],
  "dietaryFlags": ["vegan", "halal", "kosher"],
  "imageUrl": "https://cdn.eks-food.com/ingredients/tomato.jpg"
}
```

### 6.2 Recipes
| Method | Path | Permission |
|---|---|---|
| `GET` | `/recipes` | `food-domain.recipe.read` |
| `GET` | `/recipes/{id}` | `food-domain.recipe.read` |
| `POST` | `/recipes` | `food-domain.recipe.create` |
| `PATCH` | `/recipes/{id}` | `food-domain.recipe.update` |
| `DELETE` | `/recipes/{id}` | `food-domain.recipe.delete` |
| `POST` | `/recipes/{id}/publish` | `food-domain.recipe.transition-state` |
| `POST` | `/recipes/{id}/deprecate` | `food-domain.recipe.transition-state` |
| `GET` | `/recipes/{id}/ingredients` | `food-domain.ingredient.read` |
| `POST` | `/recipes/{id}/ingredients` | `food-domain.recipe.update` |
| `PATCH` | `/recipes/{id}/ingredients/{ingredientId}` | `food-domain.recipe.update` |
| `DELETE` | `/recipes/{id}/ingredients/{ingredientId}` | `food-domain.recipe.update` |
| `GET` | `/recipes/{id}/nutrition` | `food-domain.recipe.read` |
| `PUT` | `/recipes/{id}/nutrition` | `food-domain.recipe.update` |
| `POST` | `/recipes/{id}/fork` | `food-domain.recipe.create` |
| `GET` | `/recipes/{id}/menu-items` | `food-domain.menu.read` |
| `GET` | `/recipes/{id}/versions` | `food-domain.recipe.read-versions` |

**Example — Add ingredient to recipe:**
```http
POST /api/v1/food-domain/recipes/550e.../ingredients
Content-Type: application/json

{
  "ingredientId": "660e...",
  "quantity": 200,
  "unit": "g",
  "preparation": "diced",
  "optional": false,
  "position": 1
}
```

### 6.3 Menus & Menu Items
| Method | Path | Permission |
|---|---|---|
| `GET` | `/menus` | `food-domain.menu.read` |
| `GET` | `/menus/{id}` | `food-domain.menu.read` |
| `POST` | `/menus` | `food-domain.menu.create` |
| `PATCH` | `/menus/{id}` | `food-domain.menu.update` |
| `DELETE` | `/menus/{id}` | `food-domain.menu.delete` |
| `GET` | `/menus/{id}/items` | `food-domain.menu.read` |
| `POST` | `/menus/{id}/items` | `food-domain.menu.update` |
| `PATCH` | `/menus/{id}/items/{itemId}` | `food-domain.menu.update` |
| `DELETE` | `/menus/{id}/items/{itemId}` | `food-domain.menu.update` |

### 6.4 Nutrition Profiles
| Method | Path | Permission |
|---|---|---|
| `GET` | `/nutrition/{id}` | `food-domain.ingredient.read` (or recipe/menu) |
| `POST` | `/nutrition` | `food-domain.ingredient.update` |
| `PATCH` | `/nutrition/{id}` | `food-domain.ingredient.update` |
| `DELETE` | `/nutrition/{id}` | `food-domain.ingredient.update` |

---

## 7. Inventory & Logistics Routes

### 7.1 Inventory & Batches
| Method | Path | Permission |
|---|---|---|
| `GET` | `/inventories` | `food-domain.inventory.read` |
| `GET` | `/inventories/{id}` | `food-domain.inventory.read` |
| `POST` | `/inventories` | `food-domain.inventory.create` |
| `PATCH` | `/inventories/{id}` | `food-domain.inventory.update` |
| `GET` | `/inventories/{id}/batches` | `food-domain.inventory.read` |
| `POST` | `/inventories/{id}/batches` | `food-domain.inventory.update` |
| `GET` | `/inventory-batches` | `food-domain.inventory.read` |
| `GET` | `/inventory-batches/{id}` | `food-domain.inventory.read` |
| `PATCH` | `/inventory-batches/{id}` | `food-domain.inventory.update` |
| `POST` | `/inventory-batches/{id}/reserve` | `food-domain.inventory.update` |
| `POST` | `/inventory-batches/{id}/deplete` | `food-domain.inventory.update` |
| `POST` | `/inventory-batches/{id}/discard` | `food-domain.inventory.update` |
| `POST` | `/inventory-batches/{id}/return` | `food-domain.inventory.update` |
| `GET` | `/inventory-batches/{id}/versions` | `food-domain.inventory.read-versions` |

### 7.2 Equipment
| Method | Path | Permission |
|---|---|---|
| `GET` | `/equipment` | `food-domain.equipment.read` |
| `GET` | `/equipment/{id}` | `food-domain.equipment.read` |
| `POST` | `/equipment` | `food-domain.equipment.create` |
| `PATCH` | `/equipment/{id}` | `food-domain.equipment.update` |
| `DELETE` | `/equipment/{id}` | `food-domain.equipment.delete` |
| `POST` | `/equipment/{id}/repair` | `food-domain.equipment.transition-state` |
| `POST` | `/equipment/{id}/retire` | `food-domain.equipment.transition-state` |

### 7.3 Vehicles
| Method | Path | Permission |
|---|---|---|
| `GET` | `/vehicles` | `food-domain.vehicle.read` |
| `GET` | `/vehicles/{id}` | `food-domain.vehicle.read` |
| `POST` | `/vehicles` | `food-domain.vehicle.create` |
| `PATCH` | `/vehicles/{id}` | `food-domain.vehicle.update` |
| `DELETE` | `/vehicles/{id}` | `food-domain.vehicle.delete` |
| `POST` | `/vehicles/{id}/assign-driver` | `food-domain.vehicle.update` |

---

## 8. Supply Chain Routes

### 8.1 Suppliers
| Method | Path | Permission |
|---|---|---|
| `GET` | `/suppliers` | `food-domain.supplier.read` |
| `GET` | `/suppliers/{id}` | `food-domain.supplier.read` |
| `POST` | `/suppliers` | `food-domain.supplier.create` |
| `PATCH` | `/suppliers/{id}` | `food-domain.supplier.update` |
| `DELETE` | `/suppliers/{id}` | `food-domain.supplier.delete` |
| `POST` | `/suppliers/{id}/activate` | `food-domain.supplier.transition-state` |
| `POST` | `/suppliers/{id}/suspend` | `food-domain.supplier.transition-state` |
| `GET` | `/suppliers/{id}/ingredients` | `food-domain.ingredient.read` |
| `POST` | `/suppliers/{id}/ingredients` | `food-domain.supplier.update` |
| `DELETE` | `/suppliers/{id}/ingredients/{ingredientId}` | `food-domain.supplier.update` |
| `GET` | `/suppliers/{id}/kitchens` | `food-domain.kitchen.read` |
| `POST` | `/suppliers/{id}/kitchens` | `food-domain.supplier.update` |
| `GET` | `/suppliers/{id}/certifications` | `food-domain.certification.read` |
| `GET` | `/suppliers/{id}/inspections` | `food-domain.inspection.read` |

### 8.2 Vendors
| Method | Path | Permission |
|---|---|---|
| `GET` | `/vendors` | `food-domain.vendor.read` |
| `GET` | `/vendors/{id}` | `food-domain.vendor.read` |
| `POST` | `/vendors` | `food-domain.vendor.create` |
| `PATCH` | `/vendors/{id}` | `food-domain.vendor.update` |
| `DELETE` | `/vendors/{id}` | `food-domain.vendor.delete` |
| `GET` | `/vendors/{id}/equipment` | `food-domain.equipment.read` |
| `GET` | `/vendors/{id}/restaurants` | `food-domain.restaurant.read` |
| `POST` | `/vendors/{id}/restaurants` | `food-domain.vendor.update` |

---

## 9. Safety & Compliance Routes

### 9.1 Certifications
| Method | Path | Permission |
|---|---|---|
| `GET` | `/certifications` | `food-domain.certification.read` |
| `GET` | `/certifications/{id}` | `food-domain.certification.read` |
| `POST` | `/certifications` | `food-domain.certification.create` |
| `PATCH` | `/certifications/{id}` | `food-domain.certification.update` |
| `DELETE` | `/certifications/{id}` | `food-domain.certification.delete` |
| `POST` | `/certifications/{id}/verify` | `food-domain.certification.transition-state` |
| `POST` | `/certifications/{id}/revoke` | `food-domain.certification.transition-state` |
| `GET` | `/certifications/expiring` | `food-domain.certification.read` |

**Example — Create certification:**
```json
{
  "subjectType": "COOK",
  "subjectId": "550e...-cookProfileId",
  "kind": "FOOD_SAFETY_LEVEL_2",
  "issuer": "Ghana Food and Drugs Authority",
  "issuerCountryId": "country-ghana-uuid",
  "issuedAt": "2024-06-01T00:00:00Z",
  "expiresAt": "2027-06-01T00:00:00Z",
  "certificateNumber": "FDA-GH-2024-12345",
  "documentUrl": "https://cdn.eks-food.com/certs/12345.pdf"
}
```

### 9.2 Inspections
| Method | Path | Permission |
|---|---|---|
| `GET` | `/inspections` | `food-domain.inspection.read` |
| `GET` | `/inspections/{id}` | `food-domain.inspection.read` |
| `POST` | `/inspections` | `food-domain.inspection.create` |
| `PATCH` | `/inspections/{id}` | `food-domain.inspection.update` |
| `DELETE` | `/inspections/{id}` | `food-domain.inspection.delete` |
| `POST` | `/inspections/{id}/start` | `food-domain.inspection.transition-state` |
| `POST` | `/inspections/{id}/complete` | `food-domain.inspection.transition-state` |
| `POST` | `/inspections/{id}/cancel` | `food-domain.inspection.transition-state` |
| `POST` | `/inspections/{id}/no-show` | `food-domain.inspection.transition-state` |
| `POST` | `/inspections/{id}/findings/{findingId}/resolve` | `food-domain.inspection.update` |

### 9.3 Food Safety Incidents
| Method | Path | Permission |
|---|---|---|
| `GET` | `/food-safety-incidents` | `food-domain.safety.read` |
| `GET` | `/food-safety-incidents/{id}` | `food-domain.safety.read` |
| `POST` | `/food-safety-incidents` | `food-domain.safety.create` |
| `PATCH` | `/food-safety-incidents/{id}` | `food-domain.safety.update` |
| `POST` | `/food-safety-incidents/{id}/investigate` | `food-domain.safety.transition-state` |
| `POST` | `/food-safety-incidents/{id}/resolve` | `food-domain.safety.transition-state` |
| `POST` | `/food-safety-incidents/{id}/close` | `food-domain.safety.transition-state` |
| `GET` | `/food-safety-incidents/critical` | `food-domain.safety.read` |

---

## 10. Relationship Routes

The `/relationships` endpoint exposes the polymorphic `Relationship` table directly. Use this when you need to create, query, or delete edges that are not covered by a convenience route (e.g. `partner_of`, `substitutes`).

| Method | Path | Permission |
|---|---|---|
| `GET` | `/relationships` | `food-domain.relationship.read` |
| `GET` | `/relationships/{id}` | `food-domain.relationship.read` |
| `POST` | `/relationships` | `food-domain.relationship.create` |
| `PATCH` | `/relationships/{id}` | `food-domain.relationship.update` |
| `DELETE` | `/relationships/{id}` | `food-domain.relationship.delete` |
| `POST` | `/relationships/{id}/supersede` | `food-domain.relationship.update` |

**Example — Create `partner_of` edge:**
```http
POST /api/v1/food-domain/relationships
Content-Type: application/json

{
  "fromType": "Vendor",
  "fromId": "vendor-uuid",
  "toType": "Restaurant",
  "toId": "restaurant-uuid",
  "type": "partner_of",
  "properties": { "contractId": "P-2024-001", "startDate": "2024-06-01" },
  "validFrom": "2024-06-01T00:00:00Z"
}
```

**Querying:**
```http
GET /api/v1/food-domain/relationships?fromType=CookProfile&fromId={id}&type=works_at&state=ACTIVE
```

---

## 11. Graph Routes

The `/graph` routes expose the `GraphEngine` over REST. For programmatic use, prefer the `@eks/food-domain/graph` TypeScript SDK (see `GRAPH_QUERY_GUIDE.md`).

### 11.1 Traverse
```http
POST /api/v1/food-domain/graph/traverse
Content-Type: application/json

{
  "start": { "entityType": "CookProfile", "entityId": "550e..." },
  "direction": "outbound",
  "edgeTypes": ["works_at", "produces"],
  "maxDepth": 3,
  "return": "subgraph",
  "limit": 500
}
```

**Response:**
```json
{
  "data": {
    "nodes": [ /* GraphNode[] */ ],
    "edges": [ /* GraphEdge[] */ ],
    "stats": { "totalNodes": 42, "totalEdges": 58, "byDepth": { "1": 1, "2": 5, "3": 36 } }
  }
}
```

### 11.2 Shortest-path
```http
POST /api/v1/food-domain/graph/shortest-path

{
  "from": { "entityType": "Ingredient", "entityId": "tomato-uuid" },
  "to": { "entityType": "CookProfile", "entityId": "cook-uuid" },
  "edgeTypes": ["supplied_by", "supplies_to", "works_at"],
  "weighted": false,
  "maxDepth": 5
}
```

**Response:**
```json
{
  "data": {
    "found": true,
    "path": [
      { "entityType": "Ingredient", "entityId": "tomato-uuid" },
      { "entityType": "Supplier", "entityId": "supplier-uuid" },
      { "entityType": "Kitchen", "entityId": "kitchen-uuid" },
      { "entityType": "CookProfile", "entityId": "cook-uuid" }
    ],
    "edges": [ /* GraphEdge[] */ ],
    "length": 3
  }
}
```

### 11.3 Neighbors
```http
POST /api/v1/food-domain/graph/neighbors

{
  "center": { "entityType": "Recipe", "entityId": "jollof-uuid" },
  "radius": 2,
  "edgeTypes": ["contains", "supplied_by"],
  "direction": "any",
  "nodeTypes": ["Ingredient", "Supplier"]
}
```

### 11.4 As-of traversal
```http
POST /api/v1/food-domain/graph/traverse?asOf=2024-06-01T00:00:00Z
{ /* same body as /graph/traverse */ }
```

### 11.5 Snapshots
| Method | Path | Permission |
|---|---|---|
| `POST` | `/graph/snapshots` | `food-domain.graph.create-snapshot` |
| `GET` | `/graph/snapshots` | `food-domain.graph.read-snapshot` |
| `GET` | `/graph/snapshots/{id}` | `food-domain.graph.read-snapshot` |
| `GET` | `/graph/snapshots/{id}/download` | `food-domain.graph.read-snapshot` |
| `POST` | `/graph/snapshots/{id}/restore` | `food-domain.graph.restore-snapshot` |

### 11.6 Graph stats
```http
GET /api/v1/food-domain/graph/stats
```
Returns `{ nodeCount, edgeCount, byType: { Ingredient: 1234, ... }, projectionLagMs, lastReconciledAt }`.

---

## 12. Search Routes

### 12.1 Unified search
```http
POST /api/v1/food-domain/search

{
  "query": "jollof rice",
  "entityTypes": ["Recipe", "MenuItem", "Ingredient"],
  "facets": ["cuisine", "course", "allergens"],
  "filters": { "cuisine": "west-african" },
  "page": 1,
  "pageSize": 20,
  "locale": "en"
}
```

**Response:**
```json
{
  "data": [ /* SearchHit[] */ ],
  "pagination": { /* ... */ },
  "facets": {
    "cuisine": [ { "value": "west-african", "count": 42 }, ... ],
    "course": [ ... ]
  },
  "took": { "total": 23, "query": 12, "facets": 8, "highlighting": 3 }
}
```

### 12.2 Autocomplete
```http
GET /api/v1/food-domain/search/autocomplete?q=jollo&entityTypes=Recipe&locale=en
```

### 12.3 Per-entity search
Each entity list endpoint (e.g. `GET /recipes`) accepts a `?q=` query parameter for full-text search within that entity type.

See `SEARCH_ARCHITECTURE.md` for the full search contract.

---

## 13. Version & Audit Routes

Every entity supports:
```http
GET  /api/v1/food-domain/{entity}/{id}/versions
GET  /api/v1/food-domain/{entity}/{id}/versions/{v}
POST /api/v1/food-domain/{entity}/{id}/versions/{v}/restore
```

The `{entity}` path segment uses the plural kebab-case name (e.g. `recipes`, `inventory-batches`, `food-safety-incidents`).

### 13.1 Audit timeline
```http
GET /api/v1/food-domain/audit?entityType=Recipe&entityId={id}&from=2024-01-01T00:00:00Z&to=2024-12-31T23:59:59Z
```
Returns the merged timeline of `EntityVersion` rows and `AuditLog` entries for the entity.

---

## 14. Import / Export

### 14.1 Export
```http
POST /api/v1/food-domain/export
{
  "entityTypes": ["Ingredient", "Recipe", "Supplier"],
  "format": "jsonld",
  "scope": "tenant"
}
```
Returns a job ID; poll `GET /api/v1/food-domain/export/{jobId}` for status and download URL.

### 14.2 Import
```http
POST /api/v1/food-domain/import
Content-Type: multipart/form-data

file: ingredients.jsonld
```
Returns a job ID; poll `GET /api/v1/food-domain/import/{jobId}` for status and per-row results.

---

## 15. RFC 7807 Error Catalog

| HTTP | `errorCode` | `type` | When |
|---|---|---|---|
| 400 | `food-domain.validation` | `/errors/validation` | Request body fails Zod validation. |
| 401 | `food-domain.unauthorized` | `/errors/unauthorized` | Missing or invalid JWT. |
| 403 | `food-domain.forbidden` | `/errors/forbidden` | Caller lacks required permission. |
| 403 | `food-domain.cross-tenant-violation` | `/errors/cross-tenant-violation` | Reference crosses tenant boundary. |
| 404 | `food-domain.not-found` | `/errors/not-found` | Entity does not exist (or is soft-deleted and `includeDeleted=false`). |
| 409 | `food-domain.optimistic-concurrency` | `/errors/optimistic-concurrency` | `version` mismatch on update. |
| 409 | `food-domain.state-transition` | `/errors/state-transition` | Invalid state transition. |
| 409 | `food-domain.relationship-integrity` | `/errors/relationship-integrity` | Polymorphic reference is invalid. |
| 409 | `food-domain.duplicate` | `/errors/duplicate` | Unique constraint violation (e.g. `Country.iso2`). |
| 422 | `food-domain.metadata-validation` | `/errors/metadata-validation` | `metadata` JSON fails tenant schema. |
| 422 | `food-domain.json-validation` | `/errors/json-validation` | Other JSON column fails schema. |
| 422 | `food-domain.substitution-cycle` | `/errors/substitution-cycle` | `substitutes` edge would create a cycle. |
| 422 | `food-domain.invalid-quantity` | `/errors/invalid-quantity` | Recipe ingredient quantity ≤ 0, or unit conversion failed. |
| 422 | `food-domain.invalid-nutrition` | `/errors/invalid-nutrition` | Nutrition profile fails schema (negative values, missing required fields). |
| 429 | `food-domain.too-many-requests` | `/errors/too-many-requests` | Tenant rate limit exceeded. |
| 500 | `food-domain.internal` | `/errors/internal` | Unexpected server error. `traceId` included. |
| 503 | `food-domain.graph-projection-lag` | `/errors/graph-projection-lag` | Graph projection is too stale to serve a traversal query. Retry after `Retry-After` header. |

---

## 16. SDK Examples

### 16.1 TypeScript SDK
```typescript
import { FoodDomainClient } from '@eks/food-domain';

const client = new FoodDomainClient({
  baseUrl: 'https://api.eks-food.com',
  authToken: () => keycloak.token,
  organizationId: 'org-123',
});

const recipe = await client.recipes.create({
  title: { en: 'Jollof Rice' },
  cuisine: 'west-african',
  servings: 4,
  steps: [/* ... */],
});

await client.recipes.addIngredient(recipe.id, {
  ingredientId: 'tomato-uuid',
  quantity: 200, unit: 'g', position: 1,
});

await client.recipes.publish(recipe.id);

const path = await client.graph.shortestPath({
  from: { entityType: 'Ingredient', entityId: 'tomato-uuid' },
  to:   { entityType: 'CookProfile', entityId: 'cook-uuid' },
  edgeTypes: ['supplied_by', 'supplies_to', 'works_at'],
  maxDepth: 5,
});
```

### 16.2 cURL
```bash
curl -X POST https://api.eks-food.com/api/v1/food-domain/recipes \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d @recipe.json
```

---

## 17. See Also

- `DOMAIN_MODEL_REFERENCE.md` — entity field definitions.
- `ENTITY_RELATIONSHIPS.md` — edge vocabulary.
- `GRAPH_QUERY_GUIDE.md` — graph traversal via TypeScript SDK.
- `SEARCH_ARCHITECTURE.md` — search index and query DSL.
- `CANONICAL_DATA_STANDARDS.md` — naming, audit metadata, localization.
- `docs/API_CONVENTIONS.md` — general REST conventions.
- `docs/identity/API_REFERENCE.md` — M2 IAM API.
- `docs/EVENT_CONVENTIONS.md` — event envelope.
