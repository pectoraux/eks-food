/**
 * AuthService — the top-level authentication orchestrator.
 *
 * Coordinates: password hashing, identity lookup, brute-force protection,
 * MFA challenge, session issuance, audit logging, and domain-event publication.
 */
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "./password";
import { SessionService, type SessionInfo, type SessionToken, type RefreshToken } from "./session";
import { BruteForceProtector } from "./brute-force";
import { MFAService } from "./mfa";
import { buildIdentityEvent } from "@eks/identity";
import { outbox } from "@eks/events";
import { audit } from "@eks/observability";
import { IDENTITY_AUDIT_ACTIONS } from "@eks/identity";
import { uuid, asUUID } from "@eks/common";
import { UnauthorizedError, ValidationError, ConflictError } from "@eks/errors";

const sessions = new SessionService();
const bruteForce = new BruteForceProtector();
const mfa = new MFAService();

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  phone?: string;
  organizationId: string;
}

export interface LoginInput {
  email: string;
  password: string;
  organizationId?: string;
  ipAddress?: string;
  userAgent?: string;
  mfaToken?: string;
}

export interface LoginResult {
  user: { id: string; email: string; name: string; organizationId: string; status: string };
  session: SessionInfo;
  accessToken: SessionToken;
  refreshToken: RefreshToken;
  mfaRequired: false;
}

/** Register a new user with an email/password identity. */
export async function register(input: RegisterInput): Promise<{ userId: string }> {
  const existing = await db.identity.findUnique({ where: { provider_subject: { provider: "EMAIL", subject: input.email.toLowerCase() } } });
  if (existing) throw new ConflictError("An account with this email already exists");

  const passwordHash = await hashPassword(input.password);
  const user = await db.user.create({
    data: {
      email: input.email.toLowerCase(),
      name: input.name,
      phone: input.phone,
      organizationId: input.organizationId,
      roles: "CUSTOMER",
      status: "ACTIVE",
    },
  });
  await db.identity.create({
    data: {
      userId: user.id,
      provider: "EMAIL",
      subject: input.email.toLowerCase(),
      credentialHash: passwordHash,
      verified: false,
    },
  });
  await db.userPreference.create({ data: { userId: user.id } }).catch(() => null);

  // Emit domain event + audit.
  const event = buildIdentityEvent("UserRegistered", asUUID(user.id), { email: user.email, name: user.name, organizationId: input.organizationId });
  await outbox().stage(event);
  await audit.record({
    action: IDENTITY_AUDIT_ACTIONS.USER_REGISTERED,
    entityType: "User",
    entityId: user.id,
    organizationId: input.organizationId,
    actorUserId: user.id,
    metadata: { email: user.email },
  });

  return { userId: user.id };
}

/** Authenticate a user with email + password (+ optional MFA). */
export async function login(input: LoginInput): Promise<LoginResult | { mfaRequired: true; challengeToken: string }> {
  const identity = await db.identity.findUnique({
    where: { provider_subject: { provider: "EMAIL", subject: input.email.toLowerCase() } },
    include: { user: true },
  });
  if (!identity || !identity.credentialHash) {
    // Don't reveal whether the email exists — same error as bad password.
    throw new UnauthorizedError("Invalid email or password");
  }
  const user = identity.user;
  if (user.status === "LOCKED" || (user.lockedUntil && user.lockedUntil > new Date())) {
    throw new UnauthorizedError("Account is temporarily locked. Try again later.");
  }
  if (user.status === "SUSPENDED" || user.status === "DELETED") {
    throw new UnauthorizedError("Account is not active.");
  }

  // Brute-force check.
  const lockState = await bruteForce.getState(user.id);
  if (lockState.locked) {
    throw new UnauthorizedError("Too many failed attempts. Account temporarily locked.");
  }

  const valid = await verifyPassword(identity.credentialHash, input.password);
  if (!valid) {
    await bruteForce.recordFailure(user.id);
    await db.loginHistory.create({
      data: { userId: user.id, organizationId: user.organizationId, result: "FAILED", method: "PASSWORD", ipAddress: input.ipAddress, userAgent: input.userAgent, failureReason: "INVALID_PASSWORD" },
    });
    await audit.record({
      action: IDENTITY_AUDIT_ACTIONS.USER_LOGIN_FAILED,
      entityType: "User",
      entityId: user.id,
      organizationId: user.organizationId,
      metadata: { reason: "INVALID_PASSWORD", email: input.email },
    });
    throw new UnauthorizedError("Invalid email or password");
  }

  // MFA check (if the user has TOTP enabled).
  const mfaConfig = await db.mFAConfiguration.findFirst({ where: { userId: user.id, method: "TOTP", enabled: true } });
  if (mfaConfig && !input.mfaToken) {
    // Issue a one-time MFA challenge token (the client re-calls login with mfaToken).
    const challengeToken = uuid();
    return { mfaRequired: true, challengeToken };
  }
  if (mfaConfig && input.mfaToken) {
    const ok = mfa.verifyTOTP(input.mfaToken, mfaConfig.secret);
    if (!ok) {
      await audit.record({ action: IDENTITY_AUDIT_ACTIONS.USER_LOGIN_FAILED, entityType: "User", entityId: user.id, organizationId: user.organizationId, metadata: { reason: "MFA_FAILED" } });
      throw new UnauthorizedError("Invalid MFA code.");
    }
  }

  // Success — reset brute-force, issue session.
  await bruteForce.recordSuccess(user.id);
  const orgId = input.organizationId ?? user.organizationId;
  const { session, accessToken, refreshToken } = await sessions.create({
    userId: user.id,
    organizationId: orgId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginAttempts: 0 } });
  await db.loginHistory.create({
    data: { userId: user.id, organizationId: orgId, result: "SUCCESS", method: "PASSWORD", ipAddress: input.ipAddress, userAgent: input.userAgent },
  });

  const event = buildIdentityEvent("UserLoggedIn", asUUID(user.id), { organizationId: orgId, method: "PASSWORD" });
  await outbox().stage(event);
  await audit.record({ action: IDENTITY_AUDIT_ACTIONS.USER_LOGIN, entityType: "User", entityId: user.id, organizationId: orgId, actorUserId: user.id, metadata: { method: "PASSWORD", sessionId: session.id } });

  return {
    user: { id: user.id, email: user.email, name: user.name, organizationId: orgId, status: user.status },
    session,
    accessToken,
    refreshToken,
    mfaRequired: false,
  };
}

/** Logout: revoke the session. */
export async function logout(rawAccessToken: string): Promise<void> {
  const session = await sessions.validate(rawAccessToken);
  if (!session) return;
  await sessions.revoke(rawAccessToken, "USER_LOGOUT");
  const event = buildIdentityEvent("UserLoggedOut", asUUID(session.userId), { sessionId: session.id });
  await outbox().stage(event);
  await audit.record({ action: IDENTITY_AUDIT_ACTIONS.USER_LOGOUT, entityType: "Session", entityId: session.id, organizationId: session.organizationId, actorUserId: session.userId });
}

/** Change password (requires current password). */
export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const identity = await db.identity.findFirst({ where: { userId, provider: "EMAIL" } });
  if (!identity || !identity.credentialHash) throw new ValidationError("No password identity found");
  const valid = await verifyPassword(identity.credentialHash, currentPassword);
  if (!valid) throw new UnauthorizedError("Current password is incorrect");
  const newHash = await hashPassword(newPassword);
  await db.identity.update({ where: { id: identity.id }, data: { credentialHash: newHash } });
  // Revoke all sessions (force re-login) on password change.
  await sessions.revokeAllForUser(userId, "PASSWORD_CHANGED");
  const event = buildIdentityEvent("PasswordChanged", asUUID(userId), {});
  await outbox().stage(event);
  await audit.record({ action: IDENTITY_AUDIT_ACTIONS.PASSWORD_CHANGED, entityType: "User", entityId: userId, organizationId: "", actorUserId: userId });
}

/** Initiate password reset (generates a magic-link-style reset token). */
export async function requestPasswordReset(email: string): Promise<{ token: string } | null> {
  const identity = await db.identity.findUnique({
    where: { provider_subject: { provider: "EMAIL", subject: email.toLowerCase() } },
    include: { user: true },
  });
  if (!identity) return null; // Don't reveal whether the email exists.
  // Reuse the magic-link service for the reset token (single-use, short TTL).
  const { MagicLinkService } = await import("./magic-link");
  const ml = new MagicLinkService();
  const { token } = await ml.issue(identity.userId, identity.user.organizationId);
  await audit.record({ action: IDENTITY_AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED, entityType: "User", entityId: identity.userId, organizationId: identity.user.organizationId, metadata: { email } });
  return { token };
}

/** Complete password reset with a valid reset token. */
export async function resetPassword(resetToken: string, newPassword: string): Promise<void> {
  const { MagicLinkService } = await import("./magic-link");
  const ml = new MagicLinkService();
  const payload = await ml.consume(resetToken);
  if (!payload) throw new UnauthorizedError("Invalid or expired reset token");
  const identity = await db.identity.findFirst({ where: { userId: payload.userId, provider: "EMAIL" } });
  if (!identity) throw new ValidationError("No password identity found");
  const newHash = await hashPassword(newPassword);
  await db.identity.update({ where: { id: identity.id }, data: { credentialHash: newHash } });
  await sessions.revokeAllForUser(payload.userId, "PASSWORD_RESET");
  await audit.record({ action: IDENTITY_AUDIT_ACTIONS.PASSWORD_CHANGED, entityType: "User", entityId: payload.userId, organizationId: payload.organizationId });
}

export { sessions, bruteForce, mfa, sessions as sessionService };
