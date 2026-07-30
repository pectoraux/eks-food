/** Favorite Service — favorite recipes, restaurants, cooks, vendors, ingredients. */
import { db } from "@/lib/db";
import { uuid } from "@eks/common";

export class FavoriteService {
  async add(customerProfileId: string, entityType: string, entityId: string, collection?: string, notes?: string): Promise<{ id: string }> {
    const fav = await db.customerFavorite.upsert({
      where: { customerProfileId_entityType_entityId: { customerProfileId, entityType, entityId } },
      update: { collection, notes },
      create: { id: uuid(), customerProfileId, entityType, entityId, collection, notes },
    });
    return { id: fav.id };
  }

  async remove(customerProfileId: string, entityType: string, entityId: string): Promise<void> {
    await db.customerFavorite.delete({
      where: { customerProfileId_entityType_entityId: { customerProfileId, entityType, entityId } },
    }).catch(() => null);
  }

  async list(customerProfileId: string, entityType?: string): Promise<readonly unknown[]> {
    const where = entityType ? { customerProfileId, entityType } : { customerProfileId };
    return db.customerFavorite.findMany({ where, orderBy: { createdAt: "desc" } });
  }

  async collections(customerProfileId: string): Promise<readonly string[]> {
    const favs = await db.customerFavorite.findMany({ where: { customerProfileId, collection: { not: null } }, select: { collection: true }, distinct: ["collection"] });
    return favs.map((f) => f.collection!).filter(Boolean);
  }
}

export { uuid };
