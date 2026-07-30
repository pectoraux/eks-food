/** Review Service — reviews + ratings for recipes, meals, restaurants, cooks, vendors. */
import { db } from "@/lib/db";
import { uuid } from "@eks/common";
import { buildCustomerEvent } from "./events";
import { outbox } from "@eks/events";
import { audit } from "@eks/observability";
import { CUSTOMER_AUDIT_ACTIONS } from "./audit-actions";
import { asUUID } from "@eks/common";

export interface ReviewInput {
  organizationId: string;
  customerProfileId: string;
  entityType: string;
  entityId: string;
  rating: number;
  title?: string;
  comment?: string;
  photos?: string[];
}

export class ReviewService {
  async submit(input: ReviewInput): Promise<{ reviewId: string }> {
    const review = await db.review.create({
      data: {
        id: uuid(),
        organizationId: input.organizationId,
        customerProfileId: input.customerProfileId,
        entityType: input.entityType,
        entityId: input.entityId,
        rating: input.rating,
        title: input.title,
        comment: input.comment,
        photos: JSON.stringify(input.photos ?? []),
        status: "PUBLISHED",
      },
    });
    // Also create/update the rating aggregate.
    await db.rating.upsert({
      where: { customerProfileId_entityType_entityId: { customerProfileId: input.customerProfileId, entityType: input.entityType, entityId: input.entityId } },
      update: { rating: input.rating },
      create: { id: uuid(), organizationId: input.organizationId, customerProfileId: input.customerProfileId, entityType: input.entityType, entityId: input.entityId, rating: input.rating },
    });
    const event = buildCustomerEvent("ReviewSubmitted", asUUID(review.id), { entityType: input.entityType, entityId: input.entityId, rating: input.rating });
    await outbox().stage(event);
    await audit.record({ action: CUSTOMER_AUDIT_ACTIONS.REVIEW_SUBMITTED, entityType: "Review", entityId: review.id, organizationId: input.organizationId, actorUserId: input.customerProfileId, metadata: { rating: input.rating, entityType: input.entityType } });
    return { reviewId: review.id };
  }

  async moderate(reviewId: string, status: string, notes: string, moderatedById: string): Promise<void> {
    await db.review.update({ where: { id: reviewId }, data: { status, moderationNotes: notes } });
    await audit.record({ action: CUSTOMER_AUDIT_ACTIONS.REVIEW_MODERATED, entityType: "Review", entityId: reviewId, organizationId: "", actorUserId: moderatedById, metadata: { status, notes } });
  }

  async listForEntity(entityType: string, entityId: string, limit = 20): Promise<readonly unknown[]> {
    return db.review.findMany({ where: { entityType, entityId, status: "PUBLISHED" }, orderBy: { createdAt: "desc" }, take: limit });
  }

  async averageRating(entityType: string, entityId: string): Promise<{ average: number; count: number }> {
    const result = await db.rating.aggregate({
      where: { entityType, entityId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    return { average: result._avg.rating ?? 0, count: result._count.rating };
  }
}

export { uuid };
