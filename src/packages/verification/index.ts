/**
 * @eks/verification — provider-agnostic identity-verification framework.
 *
 * Milestone 2 scope: interface ONLY. No provider integrations. Future providers
 * (government ID, business, address, food-safety license, professional cert)
 * implement the `VerificationProvider` interface. The platform stores only
 * verification STATUS + provider REFERENCES — never raw documents.
 */
export type { VerificationProvider, VerificationRequestInput, VerificationResult, VerificationKind, VerificationStatus } from "./types";
export { VerificationService } from "./service";
export { ManualVerificationProvider } from "./manual-provider";
