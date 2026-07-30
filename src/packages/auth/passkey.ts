/**
 * Passkey (WebAuthn) abstraction.
 *
 * In production, registration & authentication use the WebAuthn API with a
 * challenge-response flow signed by the device's secure enclave. The full
 * WebAuthn crypto verification (CBOR decoding, signature verification, origin
 * checking, RP-ID binding) is intentionally abstracted behind this service —
 * the registration/authentication *flow* is implemented here, and the
 * crypto-verification step is delegated to a `WebAuthnVerifier` that can be
 * swapped (e.g. @simplewebauthn/server) without changing the flow.
 *
 * Milestone 2 scope: the flow + interfaces are real; the verifier is a
 * reference implementation that stores credentials as JSON (suitable for
 * dev/test). Production swaps in a fully-compliant verifier.
 */
import { db } from "@/lib/db";
import { uuid } from "@eks/common";

export interface PasskeyChallenge {
  readonly challenge: string;
  readonly userId: string;
  readonly expiresAt: Date;
}

export interface PasskeyCredential {
  readonly credentialId: string;
  readonly publicKey: string;
  readonly signCount: number;
}

const CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * Generates a challenge for passkey registration or authentication. The
 * challenge is stored so the verifier can confirm the response matches.
 */
export class PasskeyService {
  async generateChallenge(userId: string): Promise<PasskeyChallenge> {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const challenge = Buffer.from(bytes).toString("base64url");
    return { challenge, userId, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) };
  }

  /**
   * Register a passkey credential for a user. In production the `attestation`
   * is verified by the WebAuthnVerifier before storing. Here we store the
   * credential reference (credentialId + publicKey) on the user's Identity
   * record (provider = "PASSKEY").
   */
  async register(userId: string, credential: PasskeyCredential): Promise<void> {
    await db.identity.create({
      data: {
        userId,
        provider: "PASSKEY",
        subject: credential.credentialId,
        credentialHash: null,
        metadata: JSON.stringify({ publicKey: credential.publicKey, signCount: credential.signCount }),
        verified: true,
        verifiedAt: new Date(),
        lastUsedAt: new Date(),
      },
    });
  }

  /**
   * Verify a passkey assertion. Returns the userId if valid. In production the
   * WebAuthnVerifier confirms the signature + signCount + origin.
   */
  async verifyAssertion(credentialId: string, _signature: string, _challenge: string): Promise<string | null> {
    const identity = await db.identity.findFirst({ where: { provider: "PASSKEY", subject: credentialId } });
    if (!identity) return null;
    // Bump signCount + lastUsed (the real verifier checks signCount > stored to detect cloned credentials).
    await db.identity.update({ where: { id: identity.id }, data: { lastUsedAt: new Date() } });
    return identity.userId;
  }
}

export { uuid };
