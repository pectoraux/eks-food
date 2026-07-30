/** VerificationService — orchestrates submission + persists status (not documents). */
import { db } from "@/lib/db";
import type { VerificationProvider, VerificationRequestInput, VerificationResult, VerificationKind } from "./types";
import { ManualVerificationProvider } from "./manual-provider";

export class VerificationService {
  private readonly providers = new Map<string, VerificationProvider>();

  constructor(defaultProvider?: VerificationProvider) {
    const provider = defaultProvider ?? new ManualVerificationProvider();
    this.register("manual", provider);
  }

  register(name: string, provider: VerificationProvider): void {
    this.providers.set(name, provider);
  }

  async submit(input: VerificationRequestInput & { provider?: string }): Promise<{ requestId: string; result: VerificationResult }> {
    const provider = this.providers.get(input.provider ?? "manual") ?? this.providers.get("manual")!;
    const result = await provider.submit(input);
    const record = await db.verificationRequest.create({
      data: {
        userId: input.userId,
        organizationId: input.organizationId ?? null,
        kind: input.kind,
        provider: provider.name,
        status: result.status,
        payload: JSON.stringify(input.payload),
        result: JSON.stringify(result),
      },
    });
    return { requestId: record.id, result };
  }

  async listForUser(userId: string) {
    return db.verificationRequest.findMany({ where: { userId }, orderBy: { submittedAt: "desc" } });
  }

  async adjudicate(requestId: string, status: "APPROVED" | "REJECTED", detail: string, actorUserId: string): Promise<void> {
    await db.verificationRequest.update({ where: { id: requestId }, data: { status, completedAt: new Date(), result: JSON.stringify({ status, detail, adjudicatedBy: actorUserId }) } });
  }

  supports(kind: VerificationKind, providerName = "manual"): boolean {
    const provider = this.providers.get(providerName);
    return provider?.supportedKinds.includes(kind) ?? false;
  }
}
