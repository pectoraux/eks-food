/**
 * @eks/auth — the authentication engine.
 *
 * Responsibilities:
 *  - Password hashing (Argon2id)
 *  - Session issuance & refresh-token rotation (with replay-attack detection)
 *  - MFA (TOTP via @otplib, recovery codes)
 *  - Brute-force protection (progressive lockout)
 *  - Magic-link & passkey (WebAuthn) abstractions
 *
 * Integrates with M1: @eks/security (cookie signing, crypto), @eks/observability
 * (audit, context), @eks/events (domain events), @eks/cache (rate-limit state).
 *
 * Authentication providers are replaceable — the architecture is not coupled
 * to any single provider.
 */
export { hashPassword, verifyPassword, type PasswordHash } from "./password";
export { SessionService, type SessionToken, type RefreshToken, type SessionInfo } from "./session";
export { MFAService, type TOTPSecret, type RecoveryCode } from "./mfa";
export { register, login, logout, changePassword, requestPasswordReset, resetPassword, sessionService, type LoginInput, type LoginResult, type RegisterInput } from "./service";
export { MagicLinkService, type MagicLinkToken } from "./magic-link";
export { PasskeyService, type PasskeyChallenge, type PasskeyCredential } from "./passkey";
export { BruteForceProtector, type LockoutState } from "./brute-force";
