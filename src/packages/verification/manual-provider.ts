/** Manual provider — marks submissions as IN_REVIEW for human adjudication. */
import type { VerificationProvider, VerificationRequestInput, VerificationResult } from "./types";
import { uuid } from "@eks/common";

export class ManualVerificationProvider implements VerificationProvider {
  readonly name = "manual";
  readonly supportedKinds = ["GOVERNMENT_ID", "BUSINESS", "ADDRESS", "FOOD_SAFETY_LICENSE", "PROFESSIONAL_CERT"] as const;

  async submit(input: VerificationRequestInput): Promise<VerificationResult> {
    return {
      providerRequestId: `man_${uuid().slice(0, 12)}`,
      status: "IN_REVIEW",
      detail: `Manual review queued for ${input.kind}`,
    };
  }

  async checkStatus(providerRequestId: string): Promise<VerificationResult> {
    // In production, poll the provider. Here, manual reviews stay IN_REVIEW until
    // an admin adjudicates via the admin console.
    return { providerRequestId, status: "IN_REVIEW" };
  }
}
