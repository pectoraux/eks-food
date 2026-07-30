export type VerificationKind =
  | "GOVERNMENT_ID" | "BUSINESS" | "ADDRESS"
  | "FOOD_SAFETY_LICENSE" | "PROFESSIONAL_CERT";

export type VerificationStatus = "PENDING" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "EXPIRED";

export interface VerificationRequestInput {
  readonly userId: string;
  readonly organizationId?: string;
  readonly kind: VerificationKind;
  /** Provider-specific payload (references to uploaded docs — never the docs themselves). */
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface VerificationResult {
  readonly providerRequestId: string;
  readonly status: VerificationStatus;
  readonly score?: number; // 0-100 confidence
  readonly reference?: string;
  readonly detail?: string;
}

export interface VerificationProvider {
  readonly name: string;
  readonly supportedKinds: readonly VerificationKind[];
  submit(input: VerificationRequestInput): Promise<VerificationResult>;
  checkStatus(providerRequestId: string): Promise<VerificationResult>;
}
