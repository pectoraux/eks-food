/**
 * Magic-link authentication — email-based passwordless login.
 *
 * Generates a single-use, short-TTL token. The token is stored hashed; the raw
 * token is sent to the user's email. On click, the token is verified and a
 * session is issued. Tokens are single-use (revoked on first verification).
 */
import { createHash } from "node:crypto";
import { cache } from "@eks/cache";
import { uuid } from "@eks/common";

const KEY_PREFIX = "ml:";
const TTL_MS = 15 * 60_000; // 15 minutes

export interface MagicLinkToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export class MagicLinkService {
  /** Issue a magic-link token for a user. Returns the raw token (to email). */
  async issue(userId: string, organizationId: string): Promise<MagicLinkToken> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + TTL_MS);
    await cache().set(`${KEY_PREFIX}${hash(token)}`, { userId, organizationId, expiresAt: expiresAt.getTime() }, { ttlMs: TTL_MS });
    return { token, expiresAt };
  }

  /** Consume a magic-link token. Returns the user+org if valid, or null. */
  async consume(token: string): Promise<{ userId: string; organizationId: string } | null> {
    const key = `${KEY_PREFIX}${hash(token)}`;
    const payload = await cache<{ userId: string; organizationId: string; expiresAt: number }>().get(key);
    if (!payload) return null;
    if (payload.expiresAt < Date.now()) {
      await cache().delete(key);
      return null;
    }
    await cache().delete(key); // single-use
    return { userId: payload.userId, organizationId: payload.organizationId };
  }
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `ml_${Buffer.from(bytes).toString("base64url")}`;
}

function hash(token: string): string {
  
  return createHash("sha256").update(Buffer.from(token)).digest("hex");
}

export { uuid };
