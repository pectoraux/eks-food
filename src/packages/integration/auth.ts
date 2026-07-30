/**
 * Authentication framework — provider-agnostic.
 *
 * Supports: API Keys, OAuth2, JWT, Bearer Tokens, Basic Auth, Mutual TLS,
 * Signed Requests, Custom Authentication Plugins. Credentials are encrypted
 * at rest (AES-256-GCM via @eks/security); never stored in plaintext.
 */
import { encrypt, decrypt } from "@eks/security";

export type AuthType = "API_KEY" | "OAUTH2" | "JWT" | "BEARER" | "BASIC" | "MTLS" | "SIGNED" | "CUSTOM";

export interface AuthCredentials {
  readonly type: AuthType;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface AuthContext {
  readonly organizationId: string;
  readonly connectorCode: string;
  readonly credentialId: string;
}

export interface AuthResult {
  readonly ok: boolean;
  /** HTTP headers to attach to outgoing requests. */
  readonly headers?: Record<string, string>;
  /** Query params to attach to outgoing requests. */
  readonly query?: Record<string, string>;
  /** For OAuth2, the refresh token + expiry. */
  readonly refreshToken?: string;
  readonly expiresAt?: Date;
  readonly detail?: string;
}

/** Encrypt credentials before storage. */
export async function encryptCredentials(creds: AuthCredentials, secret: string): Promise<string> {
  const payload = await encrypt(JSON.stringify(creds), secret);
  return JSON.stringify(payload);
}

/** Decrypt credentials from storage. */
export async function decryptCredentials(encrypted: string, secret: string): Promise<AuthCredentials> {
  const json = await decrypt(JSON.parse(encrypted), secret);
  return JSON.parse(json) as AuthCredentials;
}

/**
 * The AuthProvider resolves credentials into request auth (headers/query).
 * Each auth type has a resolver; custom plugins implement the CUSTOM resolver.
 */
export class AuthProvider {
  /** Resolve credentials into auth headers/query for an outgoing request. */
  async resolve(credentials: AuthCredentials): Promise<AuthResult> {
    switch (credentials.type) {
      case "API_KEY":
        return this.resolveApiKey(credentials.data);
      case "BEARER":
        return this.resolveBearer(credentials.data);
      case "BASIC":
        return this.resolveBasic(credentials.data);
      case "OAUTH2":
        return this.resolveOAuth2(credentials.data);
      case "JWT":
        return this.resolveJwt(credentials.data);
      case "SIGNED":
        return this.resolveSigned(credentials.data);
      case "MTLS":
        return this.resolveMtls(credentials.data);
      case "CUSTOM":
        return this.resolveCustom(credentials.data);
      default:
        return { ok: false, detail: `Unsupported auth type: ${credentials.type}` };
    }
  }

  private resolveApiKey(data: Readonly<Record<string, unknown>>): AuthResult {
    const header = (data.header as string) ?? "X-API-Key";
    const key = data.key as string;
    if (!key) return { ok: false, detail: "Missing API key" };
    return { ok: true, headers: { [header]: key } };
  }

  private resolveBearer(data: Readonly<Record<string, unknown>>): AuthResult {
    const token = data.token as string;
    if (!token) return { ok: false, detail: "Missing bearer token" };
    return { ok: true, headers: { Authorization: `Bearer ${token}` } };
  }

  private resolveBasic(data: Readonly<Record<string, unknown>>): AuthResult {
    const username = data.username as string;
    const password = data.password as string;
    if (!username || !password) return { ok: false, detail: "Missing basic auth credentials" };
    const encoded = Buffer.from(`${username}:${password}`).toString("base64");
    return { ok: true, headers: { Authorization: `Basic ${encoded}` } };
  }

  private resolveOAuth2(data: Readonly<Record<string, unknown>>): AuthResult {
    const accessToken = data.accessToken as string;
    if (!accessToken) return { ok: false, detail: "Missing OAuth2 access token" };
    const result: AuthResult = {
      ok: true,
      headers: { Authorization: `Bearer ${accessToken}` },
      refreshToken: data.refreshToken as string | undefined,
      ...(data.expiresAt ? { expiresAt: new Date(data.expiresAt as string) } : {}),
    };
    return result;
  }

  private resolveJwt(data: Readonly<Record<string, unknown>>): AuthResult {
    const token = data.token as string;
    if (!token) return { ok: false, detail: "Missing JWT" };
    return { ok: true, headers: { Authorization: `Bearer ${token}` } };
  }

  private resolveSigned(data: Readonly<Record<string, unknown>>): AuthResult {
    const keyId = data.keyId as string;
    const secret = data.secret as string;
    if (!keyId || !secret) return { ok: false, detail: "Missing signed-request credentials" };
    // The actual signing happens per-request (the request body + timestamp are signed).
    return { ok: true, headers: { "X-Signature-KeyId": keyId } };
  }

  private resolveMtls(data: Readonly<Record<string, unknown>>): AuthResult {
    const cert = data.cert as string;
    const key = data.key as string;
    if (!cert || !key) return { ok: false, detail: "Missing mTLS cert/key" };
    // mTLS is configured at the transport layer (the fetch client uses the cert/key).
    return { ok: true };
  }

  private resolveCustom(data: Readonly<Record<string, unknown>>): AuthResult {
    const resolver = data.resolver as ((d: Readonly<Record<string, unknown>>) => AuthResult) | undefined;
    if (!resolver) return { ok: false, detail: "Missing custom auth resolver" };
    return resolver(data);
  }
}
