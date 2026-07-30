/** Organization lifecycle service — create, update, suspend, verify. */
import { asUUID } from "@eks/common";
import { db } from "@/lib/db";
import { buildIdentityEvent } from "@eks/identity";
import { outbox } from "@eks/events";
import { audit } from "@eks/observability";
import { IDENTITY_AUDIT_ACTIONS } from "@eks/identity";
import { ConflictError, NotFoundError } from "@eks/errors";
import { ORGANIZATION_TYPES } from "./types";

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  country: string;
  baseCurrency?: string;
  typeCode?: string;
  creatorUserId: string;
}

export class OrganizationService {
  async create(input: CreateOrganizationInput): Promise<{ id: string; slug: string }> {
    const slug = input.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const existing = await db.organization.findUnique({ where: { slug } });
    if (existing) throw new ConflictError("Organization slug already taken");

    // Resolve the OrganizationType (extensible registry).
    let typeId: string | null = null;
    if (input.typeCode) {
      const type = await db.organizationType.upsert({
        where: { code: input.typeCode },
        update: {},
        create: {
          code: input.typeCode,
          name: ORGANIZATION_TYPES.find((t) => t.code === input.typeCode)?.name ?? input.typeCode,
          description: ORGANIZATION_TYPES.find((t) => t.code === input.typeCode)?.description ?? "",
        },
      });
      typeId = type.id;
    }

    const org = await db.organization.create({
      data: {
        name: input.name,
        slug,
        country: input.country,
        baseCurrency: input.baseCurrency ?? "GHS",
        status: "ACTIVE",
        typeId,
      },
    });

    // Create the OWNER role for this org + a membership for the creator.
    const ownerRole = await db.role.create({
      data: {
        organizationId: org.id,
        code: "OWNER",
        name: "Organization Owner",
        scope: "ORGANIZATION",
        isSystem: true,
        active: true,
      },
    });
    await db.membership.create({
      data: {
        userId: input.creatorUserId,
        organizationId: org.id,
        roleId: ownerRole.id,
        status: "ACTIVE",
        acceptedAt: new Date(),
      },
    });
    await db.tenantConfiguration.create({ data: { organizationId: org.id } }).catch(() => null);

    const event = buildIdentityEvent("OrganizationCreated", asUUID(org.id), { name: org.name, slug: org.slug, country: org.country, creatorUserId: input.creatorUserId });
    await outbox().stage(event);
    await audit.record({ action: IDENTITY_AUDIT_ACTIONS.ORGANIZATION_CREATED, entityType: "Organization", entityId: org.id, organizationId: org.id, actorUserId: input.creatorUserId, metadata: { name: org.name, slug } });

    return { id: org.id, slug: org.slug };
  }

  async get(id: string): Promise<unknown> {
    const org = await db.organization.findUnique({ where: { id }, include: { type: true, tenantConfig: true } });
    if (!org) throw new NotFoundError("Organization", id);
    return org;
  }

  async getBySlug(slug: string) {
    return db.organization.findUnique({ where: { slug }, include: { type: true } });
  }

  async list() {
    return db.organization.findMany({ include: { type: true, _count: { select: { memberships: true } } }, orderBy: { createdAt: "desc" } });
  }

  async update(id: string, patch: { name?: string; country?: string; baseCurrency?: string; status?: string }, actorUserId: string) {
    const org = await db.organization.update({ where: { id }, data: patch });
    const event = buildIdentityEvent("OrganizationUpdated", asUUID(id), patch);
    await outbox().stage(event);
    await audit.record({ action: IDENTITY_AUDIT_ACTIONS.ORGANIZATION_UPDATED, entityType: "Organization", entityId: id, organizationId: id, actorUserId, metadata: patch });
    return org;
  }

  async suspend(id: string, actorUserId: string, reason: string) {
    const org = await db.organization.update({ where: { id }, data: { status: "SUSPENDED" } });
    // Revoke all active sessions in the suspended org.
    await db.session.updateMany({ where: { organizationId: id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "ORG_SUSPENDED" } });
    const event = buildIdentityEvent("OrganizationSuspended", asUUID(id), { reason });
    await outbox().stage(event);
    await audit.record({ action: IDENTITY_AUDIT_ACTIONS.ORGANIZATION_SUSPENDED, entityType: "Organization", entityId: id, organizationId: id, actorUserId, metadata: { reason } });
    return org;
  }
}
