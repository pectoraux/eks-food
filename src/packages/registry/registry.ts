/** Extension registry — discovery, search, version history. */
import { db } from "@/lib/db";

export class ExtensionRegistry {
  async list(opts?: { publisherId?: string; category?: string; q?: string; limit?: number }) {
    const where: Record<string, unknown> = {};
    if (opts?.publisherId) where.publisherId = opts.publisherId;
    if (opts?.category) where.category = opts.category;
    if (opts?.q) {
      where.OR = [
        { name: { contains: opts.q } },
        { description: { contains: opts.q } },
        { identifier: { contains: opts.q } },
      ];
    }
    return db.extension.findMany({
      where,
      include: { publisher: true, latestVersion: true },
      orderBy: { createdAt: "desc" },
      take: opts?.limit ?? 50,
    });
  }

  async get(identifier: string) {
    return db.extension.findUnique({
      where: { identifier },
      include: { publisher: true, versions: { orderBy: { createdAt: "desc" } } },
    });
  }

  async versions(extensionId: string) {
    return db.extensionVersion.findMany({
      where: { extensionId },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(input: { identifier: string; name: string; description?: string; publisherId: string; category?: string; tags?: string; iconUrl?: string }) {
    return db.extension.create({ data: { ...input, status: "PENDING", visibility: "PRIVATE" } });
  }

  async publishVersion(input: { extensionId: string; version: string; manifest: string; checksum: string; signature?: string; sizeBytes: number; changelog?: string; compatRange: string }) {
    const versionRecord = await db.extensionVersion.create({
      data: { ...input, status: "RELEASED", publishedAt: new Date() },
    });
    // Update the extension's latestVersionId.
    await db.extension.update({ where: { id: input.extensionId }, data: { latestVersionId: versionRecord.id, status: "ACTIVE" } });
    return versionRecord;
  }
}
