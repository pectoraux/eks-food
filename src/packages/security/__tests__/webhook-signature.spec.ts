import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * verifyWebhookSignature — HMAC-SHA256 webhook signature verifier.
 *
 * Signs a payload with a shared secret using HMAC-SHA256 and
 * constant-time comparison of the resulting digest. Mirrors the
 * conventions used by Stripe / GitHub / Shopify webhook headers.
 *
 * Implemented in the test file because @eks/integration's webhook
 * receiver is landing concurrently. This gives us a deterministic,
 * well-tested primitive the runtime can later adopt.
 *
 * Convention:
 *  - The signature header is the hex-encoded HMAC digest, optionally
 *    prefixed with `sha256=` (Stripe-style). Both forms verify.
 *  - Comparison uses `crypto.timingSafeEqual` to avoid timing oracles.
 */

export interface WebhookSignatureOptions {
  /** Tolerance window in ms for replay protection (default: 5 minutes). */
  readonly toleranceMs?: number;
  /** Inject now() (default: Date.now). */
  readonly now?: () => number;
}

/**
 * Compute the HMAC-SHA256 hex signature of `payload` under `secret`.
 */
export function signWebhookPayload(payload: string, secret: string): string {
  const key = Buffer.from(secret, "utf8");
  const msg = Buffer.from(payload, "utf8");
  return createHmac("sha256", key).update(msg).digest("hex");
}

/**
 * Verify a webhook signature. Returns true iff:
 *  - the signature matches the computed HMAC (constant-time),
 *  - the timestamp in the payload is within `toleranceMs` of `now()`
 *    (when a timestamp is supplied via `signedAtMs`).
 *
 * For tests that focus only on signature validity, the timestamp
 * tolerance check is opt-in via the `signedAtMs` field. Callers
 * without a timestamp skip the replay check.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  opts: WebhookSignatureOptions & { signedAtMs?: number } = {},
): boolean {
  if (typeof signature !== "string" || signature.length === 0) return false;
  if (typeof secret !== "string" || secret.length === 0) return false;

  const expected = signWebhookPayload(payload, secret);
  const received = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;

  // Constant-time comparison via crypto.timingSafeEqual. The two
  // buffers MUST be the same length; if not, the signature is
  // obviously invalid.
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;

  // Optional replay-protection window.
  if (opts.signedAtMs !== undefined) {
    const now = opts.now?.() ?? Date.now();
    const tolerance = opts.toleranceMs ?? 5 * 60_000;
    if (Math.abs(now - opts.signedAtMs) > tolerance) return false;
  }
  return true;
}

describe("verifyWebhookSignature", () => {
  const secret = "whsec_test_secret_for_eks_food_integration";
  const payload = JSON.stringify({
    type: "payment.succeeded",
    data: { id: "pi_123", amount: 12800, currency: "GHS" },
  });

  it("a valid signature passes verification", () => {
    const sig = signWebhookPayload(payload, secret);
    expect(verifyWebhookSignature(payload, sig, secret)).toBe(true);
  });

  it("accepts the Stripe-style `sha256=` hex prefix", () => {
    const sig = "sha256=" + signWebhookPayload(payload, secret);
    expect(verifyWebhookSignature(payload, sig, secret)).toBe(true);
  });

  it("a tampered payload fails verification", () => {
    const sig = signWebhookPayload(payload, secret);
    const tampered = JSON.stringify({
      type: "payment.succeeded",
      data: { id: "pi_123", amount: 99999, currency: "GHS" },
    });
    expect(verifyWebhookSignature(tampered, sig, secret)).toBe(false);
  });

  it("a wrong secret fails verification", () => {
    const sig = signWebhookPayload(payload, secret);
    expect(verifyWebhookSignature(payload, sig, "whsec_some_other_secret")).toBe(false);
  });

  it("different payloads produce different signatures", () => {
    const sig1 = signWebhookPayload('{"event":"a"}', secret);
    const sig2 = signWebhookPayload('{"event":"b"}', secret);
    expect(sig1).not.toBe(sig2);
    expect(sig1.length).toBe(64); // 32 bytes hex
    expect(sig2.length).toBe(64);
  });

  it("the same payload + secret produces the same signature (deterministic)", () => {
    const sig1 = signWebhookPayload(payload, secret);
    const sig2 = signWebhookPayload(payload, secret);
    expect(sig1).toBe(sig2);
  });

  it("empty signature is rejected", () => {
    expect(verifyWebhookSignature(payload, "", secret)).toBe(false);
  });

  it("empty secret is rejected", () => {
    const sig = signWebhookPayload(payload, secret);
    expect(verifyWebhookSignature(payload, sig, "")).toBe(false);
  });

  it("signature of different length is rejected (no throw)", () => {
    expect(verifyWebhookSignature(payload, "deadbeef", secret)).toBe(false);
  });

  it("non-hex signature is rejected without throwing", () => {
    const notHex = "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
    expect(verifyWebhookSignature(payload, notHex, secret)).toBe(false);
  });

  it("optional replay protection: within tolerance passes, outside fails", () => {
    const now = 1_700_000_000_000;
    const sig = signWebhookPayload(payload, secret);

    // Within 5-min tolerance — passes.
    expect(
      verifyWebhookSignature(payload, sig, secret, {
        now: () => now,
        signedAtMs: now - 60_000,
        toleranceMs: 5 * 60_000,
      }),
    ).toBe(true);

    // Just outside tolerance — fails.
    expect(
      verifyWebhookSignature(payload, sig, secret, {
        now: () => now,
        signedAtMs: now - 5 * 60_000 - 1,
        toleranceMs: 5 * 60_000,
      }),
    ).toBe(false);

    // Future-dated signature beyond tolerance — fails.
    expect(
      verifyWebhookSignature(payload, sig, secret, {
        now: () => now,
        signedAtMs: now + 5 * 60_000 + 1,
        toleranceMs: 5 * 60_000,
      }),
    ).toBe(false);
  });

  it("handles unicode / emoji payloads correctly", () => {
    const unicodePayload = JSON.stringify({ msg: "🥘 jollof rice — ₵128" });
    const sig = signWebhookPayload(unicodePayload, secret);
    expect(verifyWebhookSignature(unicodePayload, sig, secret)).toBe(true);
    // Tamper one emoji byte → fails.
    const tampered = unicodePayload.replace("🥘", "🍲");
    expect(verifyWebhookSignature(tampered, sig, secret)).toBe(false);
  });

  it("returns false rather than throwing for malformed signature strings", () => {
    const malformed =
      "not-a-real-signature-but-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    expect(verifyWebhookSignature(payload, malformed, secret)).toBe(false);
  });
});
