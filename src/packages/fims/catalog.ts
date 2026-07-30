/**
 * Catalog Service — food catalog management with taxonomy, aliases, variants.
 */
import { db } from "@/lib/db";
import { uuid } from "@eks/common";

export interface CatalogSearchQuery {
  readonly q?: string;
  readonly itemType?: string;
  readonly barcode?: string;
  readonly sku?: string;
  readonly category?: string;
  readonly allergen?: string;
  readonly dietary?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export class CatalogService {
  /** Create a catalog item. */
  async create(input: {
    organizationId?: string;
    code: string;
    name: string;
    nameLocalized?: Record<string, string>;
    description?: string;
    itemType?: string;
    aliases?: string[];
    barcode?: string;
    sku?: string;
    supplierId?: string;
    categories?: string[];
    metadata?: Record<string, unknown>;
  }) {
    return db.foodCatalog.create({
      data: {
        id: uuid(),
        organizationId: input.organizationId,
        code: input.code,
        name: input.name,
        nameLocalized: JSON.stringify(input.nameLocalized ?? {}),
        description: input.description,
        itemType: input.itemType ?? "INGREDIENT",
        aliases: JSON.stringify(input.aliases ?? []),
        barcode: input.barcode,
        sku: input.sku,
        supplierId: input.supplierId,
        categories: JSON.stringify(input.categories ?? []),
        metadata: JSON.stringify(input.metadata ?? {}),
        status: "DRAFT",
      },
    });
  }

  /** Search catalog items with faceted filtering. */
  async search(query: CatalogSearchQuery) {
    const where: Record<string, unknown> = {};
    if (query.q) {
      where.OR = [
        { name: { contains: query.q } },
        { code: { contains: query.q } },
        { description: { contains: query.q } },
        { aliases: { contains: query.q } },
      ];
    }
    if (query.itemType) where.itemType = query.itemType;
    if (query.barcode) where.barcode = query.barcode;
    if (query.sku) where.sku = query.sku;
    if (query.category) where.categories = { contains: query.category };
    if (query.allergen) where.nutritionFacts = { some: { allergens: { contains: query.allergen } } };
    if (query.dietary) where.nutritionFacts = { some: { dietaryTags: { contains: query.dietary } } };

    const limit = Math.min(100, query.limit ?? 20);
    const offset = query.offset ?? 0;
    const [items, total] = await Promise.all([
      db.foodCatalog.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset, include: { _count: { select: { variants: true, nutritionFacts: true } } } }),
      db.foodCatalog.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  /** Get a catalog item by ID. */
  async get(id: string) {
    return db.foodCatalog.findUnique({ where: { id }, include: { variants: true, nutritionFacts: true } });
  }

  /** Get a catalog item by code. */
  async getByCode(code: string) {
    return db.foodCatalog.findUnique({ where: { code }, include: { variants: true, nutritionFacts: true } });
  }

  /** Get a catalog item by barcode. */
  async getByBarcode(barcode: string) {
    return db.foodCatalog.findFirst({ where: { barcode }, include: { variants: true, nutritionFacts: true } });
  }

  /** List taxonomy categories. */
  async categories(parentId?: string, type?: string) {
    const where: Record<string, unknown> = {};
    if (parentId) where.parentId = parentId;
    if (type) where.type = type;
    return db.foodCategory.findMany({ where, orderBy: { sortOrder: "asc" } });
  }

  /** Create a taxonomy category. */
  async createCategory(input: { parentId?: string; code: string; name: string; type?: string; description?: string }) {
    return db.foodCategory.create({ data: { id: uuid(), ...input } });
  }

  /** List measurement units. */
  async measurementUnits() {
    return db.measurementUnit.findMany({ where: { active: true }, orderBy: { type: "asc" } });
  }
}

export { uuid };
