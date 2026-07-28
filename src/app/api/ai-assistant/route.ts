import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MessageSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).default([]),
  context: z.enum(["customer", "cook", "manager", "admin", "general"]).default("general"),
});

const SYSTEM_PROMPTS: Record<string, string> = {
  customer: `You are the Eks-Food Customer AI Assistant. Eks-Food is a Cooking-as-a-Service platform connecting households across Africa with trusted, verified cooks who prepare meals in customers' homes.

Help customers with:
- Choosing a service (In-Home Cooking, Weekly Meal Prep, Event Catering, Special Diet Cooking)
- Picking a cuisine (Ghanaian, Nigerian, Vegan, Continental, Pastries, Grills)
- Understanding pricing (hourly rates ~GHS 50-65, service base prices)
- Booking flow and what to expect
- Meal planning and dietary needs

Be warm, practical, and concise. Suggest concrete next steps. Use GHS as currency. Keep replies under 180 words unless asked for detail.`,

  cook: `You are the Eks-Food Cook Copilot. You help verified cooks on the Eks-Food platform manage their cooking business.

Help cooks with:
- Maximising earnings and ratings
- Managing availability and response times
- Preparing for inspections and certifications
- Improving cuisine skills and customer satisfaction
- Understanding payouts (80% cook share, paid via Payswap)

Be encouraging, specific, and action-oriented. Keep replies under 180 words unless asked for detail.`,

  manager: `You are the Eks-Food Area Manager Copilot. You help managers run their territory.

Help managers with:
- Worker recruitment, approval, and performance monitoring
- Dispatch and assignment decisions (distance, rating, availability, cuisine, price, language, preference)
- Quality management and customer support
- Reading operational analytics and KPIs

Be analytical and decisive. Reference the matching signals (distance, rating, availability, cuisine, price, language, preference). Keep replies under 200 words.`,

  admin: `You are the Eks-Food Admin Copilot. You help super admins configure the platform.

Help admins with:
- Configuring services, pricing rules, regions, meal categories
- Managing feature flags (ai_assistant, group_purchasing, shared_cooking, restaurant_marketplace, ready_meals, procurement, food_intelligence)
- Reading platform KPIs (verified cooks, customers, GPV, payouts, completion rate)
- Multi-tenant and multi-country expansion planning

Emphasise that everything is config-driven — new capabilities are enabled via flags, never code changes. Keep replies under 200 words.`,

  general: `You are the Eks-Food AI Assistant. Eks-Food is a Food Services Operating System for Africa — a Cooking-as-a-Service platform that connects households with trusted cooks, with a roadmap into ingredient procurement, group purchasing, shared cooking, a restaurant & street food marketplace, food safety inspections, ready meals, and food intelligence analytics.

Payments are fully delegated to Payswap (a Stripe-like provider) — Eks-Food never stores card or mobile money data, only payment references.

Help the user understand the platform, its modules, and how to use them. Be concise, specific, and professional. Keep replies under 200 words unless asked for detail.`,
};

/**
 * POST /api/ai-assistant
 * Streaming-friendly LLM chat. Maintains conversation history per request.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = MessageSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed", issues: parsed.error.issues }, { status: 422 });
  const input = parsed.data;

  // Pull live platform context to ground the assistant.
  const org = await db.organization.findFirst({ where: { slug: "eks-ghana" } });
  let platformContext = "";
  if (org) {
    const [cookCount, serviceCount, flagCount] = await Promise.all([
      db.cook.count({ where: { organizationId: org.id, verificationStatus: "APPROVED" } }),
      db.service.count({ where: { organizationId: org.id, active: true } }),
      db.featureFlag.count({ where: { organizationId: org.id, enabled: true } }),
    ]);
    platformContext = `\n\n[Live platform context: ${cookCount} verified cooks, ${serviceCount} active services, ${flagCount} enabled feature flags, currency GHS, country Ghana.]`;
  }

  const systemPrompt = SYSTEM_PROMPTS[input.context] ?? SYSTEM_PROMPTS.general;

  const messages: { role: "assistant" | "user"; content: string }[] = [
    { role: "assistant", content: systemPrompt + platformContext },
    ...input.history.map((m) => ({ role: m.role, content: m.content } as const)),
    { role: "user", content: input.message },
  ];

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages,
      thinking: { type: "disabled" },
    });
    const content = completion.choices[0]?.message?.content ?? "I'm sorry, I couldn't generate a response. Please try again.";
    return NextResponse.json({ reply: content, context: input.context });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json(
      { error: "llm_failed", message, reply: "I'm having trouble connecting to the model right now. Please try again in a moment." },
      { status: 200 }
    );
  }
}
