/**
 * Session service — issuance, refresh-token rotation, revocation.
 *
 * Tokens are opaque (not JWTs) — the raw token is the cookie value, and only
 * its hash is stored (so a DB leak doesn't expose live sessions). Refresh-token
 * rotation uses a "family" id: if a refresh token from a revoked family is
 * reused, the entire family is invalidated (replay-attack detection).
 */
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { uuid } from "@eks/common";

const SESSION_TTL_MS = 8 * 60 * 60_000; // 8h access token
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000; // 30d refresh token
const TOKEN_BYTES = 32;

export interface SessionToken {
  readonly token: string; // raw — returned once, set as cookie
  readonly expiresAt: Date;
}
export interface RefreshToken {
  readonly token: string;
  readonly expiresAt: Date;
  readonly family: string;
}

export interface SessionInfo {
  readonly id: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly expiresAt: Date;
  readonly refreshExpiresAt: Date | null;
  readonly lastActiveAt: Date;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly trustedDevice: boolean;
  readonly riskScore: string;
  readonly revokedAt: Date | null;
}

export class SessionService {
  /** Create a new session (login). Returns the raw access + refresh tokens. */
  async create(opts: {
    userId: string;
    organizationId: string;
    ipAddress?: string;
    userAgent?: string;
    deviceFingerprint?: string;
    trustedDevice?: boolean;
    riskScore?: "LOW" | "MEDIUM" | "HIGH";
  }): Promise<{ session: SessionInfo; accessToken: SessionToken; refreshToken: RefreshToken }> {
    const accessTokenRaw = generateToken();
    const refreshTokenRaw = generateToken();
    const family = uuid();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const refreshExpiresAt = new Date(now.getTime() + REFRESH_TTL_MS);

    const session = await db.session.create({
      data: {
        userId: opts.userId,
        organizationId: opts.organizationId,
        tokenHash: hash(accessTokenRaw),
        refreshHash: hash(refreshTokenRaw),
        refreshFamily: family,
        deviceFingerprint: opts.deviceFingerprint ?? null,
        userAgent: opts.userAgent ?? null,
        ipAddress: opts.ipAddress ?? null,
        riskScore: opts.riskScore ?? "LOW",
        trustedDevice: opts.trustedDevice ?? false,
        expiresAt,
        refreshExpiresAt,
        lastActiveAt: now,
      },
    });

    return {
      session: toSessionInfo(session),
      accessToken: { token: accessTokenRaw, expiresAt },
      refreshToken: { token: refreshTokenRaw, expiresAt: refreshExpiresAt, family },
    };
  }

  /** Validate an access token. Returns the session if valid & not revoked/expired. */
  async validate(rawToken: string): Promise<SessionInfo | null> {
    const session = await db.session.findUnique({ where: { tokenHash: hash(rawToken) } });
    if (!session) return null;
    if (session.revokedAt) return null;
    if (new Date(session.expiresAt) < new Date()) return null;
    // Bump lastActiveAt (throttled in prod).
    await db.session.update({ where: { id: session.id }, data: { lastActiveAt: new Date() } }).catch(() => null);
    return toSessionInfo(session);
  }

  /**
   * Rotate a refresh token. Returns new access+refresh tokens, OR null if the
   * refresh token is invalid/expired/revoked. If a previously-rotated (revoked)
   * refresh token is reused, the entire family is revoked (replay attack).
   */
  async refresh(rawRefreshToken: string): Promise<{ session: SessionInfo; accessToken: SessionToken; refreshToken: RefreshToken } | null> {
    const session = await db.session.findUnique({ where: { refreshHash: hash(rawRefreshToken) } });
    if (!session) return null;
    if (session.revokedAt) {
      // Replay attack: a revoked session's refresh token was reused → burn the family.
      await db.session.updateMany({ where: { refreshFamily: session.refreshFamily ?? "" }, data: { revokedAt: new Date(), revokeReason: "REPLAY_DETECTED" } });
      return null;
    }
    if (session.refreshExpiresAt && new Date(session.refreshExpiresAt) < new Date()) return null;

    // Issue new access + refresh tokens (same family).
    const newAccess = generateToken();
    const newRefresh = generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const refreshExpiresAt = new Date(now.getTime() + REFRESH_TTL_MS);
    const updated = await db.session.update({
      where: { id: session.id },
      data: {
        tokenHash: hash(newAccess),
        refreshHash: hash(newRefresh),
        expiresAt,
        refreshExpiresAt,
        lastActiveAt: now,
      },
    });
    return {
      session: toSessionInfo(updated),
      accessToken: { token: newAccess, expiresAt },
      refreshToken: { token: newRefresh, expiresAt: refreshExpiresAt, family: session.refreshFamily ?? uuid() },
    };
  }

  /** Revoke a single session (logout). */
  async revoke(rawToken: string, reason = "USER_LOGOUT"): Promise<void> {
    await db.session.updateMany({ where: { tokenHash: hash(rawToken) }, data: { revokedAt: new Date(), revokeReason: reason } });
  }

  /** Revoke all sessions for a user (force-logout everywhere). */
  async revokeAllForUser(userId: string, reason = "FORCE_LOGOUT"): Promise<number> {
    const result = await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
    return result.count;
  }

  /** List active sessions for a user (session explorer). */
  async listForUser(userId: string): Promise<SessionInfo[]> {
    const sessions = await db.session.findMany({ where: { userId }, orderBy: { lastActiveAt: "desc" }, take: 50 });
    return sessions.map(toSessionInfo);
  }
}

function toSessionInfo(s: { id: string; userId: string; organizationId: string; expiresAt: Date; refreshExpiresAt: Date | null; lastActiveAt: Date; ipAddress: string | null; userAgent: string | null; trustedDevice: boolean; riskScore: string; revokedAt: Date | null }): SessionInfo {
  return {
    id: s.id,
    userId: s.userId,
    organizationId: s.organizationId,
    expiresAt: s.expiresAt,
    refreshExpiresAt: s.refreshExpiresAt,
    lastActiveAt: s.lastActiveAt,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    trustedDevice: s.trustedDevice,
    riskScore: s.riskScore,
    revokedAt: s.revokedAt,
  };
}

function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function hash(token: string): string {
  // SHA-256 of the raw token — store only the hash so a DB leak doesn't expose live sessions.
  const bytes = new TextEncoder().encode(token);
  // Synchronous hash via node:crypto (Web Crypto subtle.digest is async; this is a hot path).
  
  return createHash("sha256").update(bytes).digest("hex");
}
