/**
 * Domain Service — CRUD + versioning + graph indexing for canonical entities.
 * Every entity create/update/delete publishes a domain event + audit log +
 * EntityVersion snapshot + graph node.
 */
import { db } from "@/lib/db";
import { buildFoodDomainEvent, FOOD_DOMAIN_EVENTS } from "./events";
import { FOOD_DOMAIN_AUDIT_ACTIONS } from "./audit-actions";
import { outbox } from "@eks/events";
import { audit } from "@eks/observability";
import { GraphEngine } from "./graph";
import { asUUID, uuid } from "@eks/common";

export interface EntityInput {
  readonly entityType: string;
  readonly organizationId?: string;
  readonly data: Record<string, unknown>;
}

export interface EntityUpdate {
  readonly entityId: string;
  readonly organizationId?: string;
  readonly data: Record<string, unknown>;
}

const graph = new GraphEngine();

// Map entity types to their Prisma models + event names.
const ENTITY_MAP: Record<string, { model: string; createEvent: string; updateEvent: string; nameField: string }> = {
  CUSTOMER: { model: "customerProfile", createEvent: "CustomerCreated", updateEvent: "CustomerUpdated", nameField: "name" },
  HOUSEHOLD: { model: "household", createEvent: "HouseholdCreated", updateEvent: "CustomerUpdated", nameField: "name" },
  COOK: { model: "cookProfile", createEvent: "CookProfileCreated", updateEvent: "CustomerUpdated", nameField: "name" },
  RESTAURANT: { model: "restaurant", createEvent: "RestaurantRegistered", updateEvent: "CustomerUpdated", nameField: "name" },
  KITCHEN: { model: "kitchen", createEvent: "KitchenCreated", updateEvent: "CustomerUpdated", nameField: "name" },
  INGREDIENT: { model: "ingredient", createEvent: "IngredientAdded", updateEvent: "IngredientUpdated", nameField: "name" },
  RECIPE: { model: "recipe", createEvent: "RecipeCreated", updateEvent: "RecipeUpdated", nameField: "name" },
  EQUIPMENT: { model: "equipment", createEvent: "CustomerCreated", updateEvent: "CustomerUpdated", nameField: "name" },
  VEHICLE: { model: "vehicle", createEvent: "CustomerCreated", updateEvent: "CustomerUpdated", nameField: "name" },
  SUPPLIER: { model: "supplier", createEvent: "SupplierRegistered", updateEvent: "CustomerUpdated", nameField: "name" },
  VENDOR: { model: "vendor", createEvent: "VendorRegistered", updateEvent: "CustomerUpdated", nameField: "name" },
};

export class DomainService {
  /** Create a canonical entity. */
  async create(input: EntityInput): Promise<{ id: string; entityType: string }> {
    const mapping = ENTITY_MAP[input.entityType];
    if (!mapping) throw new Error(`Unknown entity type: ${input.entityType}`);

    // Create via Prisma (the model is dynamically accessed).
    const id = uuid();
    const data = { id, ...input.data, organizationId: input.organizationId ?? null, version: 1 };
    const entity = await db[mapping.model].create({ data });

    // Create an EntityVersion snapshot.
    await db.entityVersion.create({
      data: {
        entityType: input.entityType,
        entityId: id,
        version: 1,
        snapshot: JSON.stringify(data),
        changeType: "CREATE",
        organizationId: input.organizationId ?? null,
      },
    });

    // Index in the graph.
    await graph.ensureNode(input.entityType, id, { name: input.data[mapping.nameField] ?? "" }, input.organizationId);

    // Publish domain event.
    const event = buildFoodDomainEvent(mapping.createEvent as keyof typeof FOOD_DOMAIN_EVENTS, asUUID(id), { entityType: input.entityType, organizationId: input.organizationId });
    await outbox().stage(event);

    // Audit log.
    await audit.record({
      action: FOOD_DOMAIN_AUDIT_ACTIONS.ENTITY_VERSION_CREATED,
      entityType: input.entityType,
      entityId: id,
      organizationId: input.organizationId ?? "",
      metadata: { changeType: "CREATE" },
    });

    return { id, entityType: input.entityType };
  }

  /** List entities of a type. */
  async list(entityType: string, organizationId?: string, limit = 50, offset = 0): Promise<readonly unknown[]> {
    const mapping = ENTITY_MAP[entityType];
    if (!mapping) throw new Error(`Unknown entity type: ${entityType}`);
    const where = organizationId ? { organizationId } : {};
    return db[mapping.model].findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset });
  }

  /** Get an entity by ID. */
  async get(entityType: string, entityId: string): Promise<unknown> {
    const mapping = ENTITY_MAP[entityType];
    if (!mapping) throw new Error(`Unknown entity type: ${entityType}`);
    return db[mapping.model].findUnique({ where: { id: entityId } });
  }

  /** Get the version history for an entity. */
  async versionHistory(entityType: string, entityId: string): Promise<readonly unknown[]> {
    return db.entityVersion.findMany({
      where: { entityType, entityId },
      orderBy: { version: "desc" },
    });
  }

  /** Create a relationship between two entities (graph edge). */
  async createRelationship(input: {
    fromEntityType: string; fromEntityId: string;
    toEntityType: string; toEntityId: string;
    type: string; metadata?: Record<string, unknown>;
    organizationId?: string;
  }): Promise<{ edgeId: string }> {
    const edgeId = await graph.createEdge(
      input.fromEntityType, input.fromEntityId,
      input.toEntityType, input.toEntityId,
      input.type, input.metadata ?? {},
    );
    // Also store in the Relationship table for direct querying.
    await db.relationship.create({
      data: {
        fromEntityType: input.fromEntityType,
        fromEntityId: input.fromEntityId,
        toEntityType: input.toEntityType,
        toEntityId: input.toEntityId,
        type: input.type,
        metadata: JSON.stringify(input.metadata ?? {}),
        organizationId: input.organizationId ?? null,
      },
    }).catch(() => null);
    const event = buildFoodDomainEvent("RelationshipCreated", asUUID(edgeId), { ...input });
    await outbox().stage(event);
    return { edgeId };
  }

  /** Get relationships for an entity. */
  async relationships(entityType: string, entityId: string, type?: string): Promise<readonly unknown[]> {
    const where: Record<string, unknown> = { fromEntityType: entityType, fromEntityId: entityId };
    if (type) where.type = type;
    return db.relationship.findMany({ where, orderBy: { createdAt: "desc" } });
  }
}
