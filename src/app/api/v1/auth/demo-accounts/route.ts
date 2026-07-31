import { db } from "@/lib/db";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const accounts = await db.demoAccount.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      role: true,
      displayName: true,
      description: true,
      responsibilities: true,
      availableTools: true,
      aiTeam: true,
      workflows: true,
      icon: true,
      sortOrder: true,
    },
  });

  // Parse JSON fields
  const parsed = accounts.map((a) => ({
    ...a,
    responsibilities: JSON.parse(a.responsibilities),
    availableTools: JSON.parse(a.availableTools),
    workflows: JSON.parse(a.workflows),
    aiTeam: a.aiTeam ?? undefined,
  }));

  return success(parsed);
});
