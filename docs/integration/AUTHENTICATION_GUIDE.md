# Eks-Food Connector Authentication Guide

> **Audience:** Connector authors and platform security reviewers. Read alongside `ARCHITECTURE.md` (bounded contexts incl. Authentication & Secrets), `CONNECTOR_DEVELOPMENT.md` (the `authenticate()` method), the M2 `docs/identity/AUTHENTICATION_FLOWS.md` (user-facing auth, which this guide is **not** about — this guide covers machine-to-machine connector auth), and the M2 `docs/identity/SECURITY_HARDENING.md` (cryptographic primitives).
>
> **Status:** M4. The Authentication bounded context lives in `@eks/integration/auth.ts` and the Secrets bounded context in `@eks/integration/secrets.ts`. Credentials are stored in `ConnectorCredential` (per-configuration) and `SecretReference` (cross-connector reusable secrets, e.g. a Payswap key shared by 5 connectors). Both are AES-256-GCM encrypted at rest via the M2 `@eks/security/crypto` envelope.

---

## 1. Authentication Strategies

The platform ships with eight built-in authentication strategies. Each is implemented as an **auth plugin** in `@eks/integration/auth/strategies/<name>.ts`. A connector declares its strategy in the manifest:

```json5
// eks.manifest.json5
{
  connector: {
    auth: {
      strategy: "oauth2-client-credentials",
      // strategy-specific config; validated against the strategy's schema
      tokenUrl: "https://acme.test/oauth/token",
      scopes: ["orders:read", "menu:read"],
      tokenTtlSeconds: 3600,
    },
  },
}
```

The runtime resolves the strategy by name, loads the plugin, and invokes `plugin.authenticate(config, credentials, ctx)` to materialise the per-invocation auth context. The auth context is cached in Redis (`auth:{credentialId}`) for `tokenTtlSeconds` (or 60s before expiry, whichever is sooner). The connector's `authenticate()` method is the fallback used when no strategy is declared — connector authors can implement their own logic if none of the eight built-ins fit.

| # | Strategy | Plugin file | Use case |
|---|---|---|---|
| 1 | `api-key` | `strategies/api-key.ts` | Header or query-param API keys (Acme POS, SendGrid, Twilio) |
| 2 | `oauth2-authorization-code` | `strategies/oauth2-auth-code.ts` | User-delegated access (Google Sheets, Slack, Microsoft Graph) |
| 3 | `oauth2-client-credentials` | `strategies/oauth2-client-creds.ts` | Machine-to-machine (Acme POS, Stripe, Xero) |
| 4 | `oauth2-refresh` | `strategies/oauth2-refresh.ts` | Refresh-token rotation for #2 |
| 5 | `jwt-bearer` | `strategies/jwt-bearer.ts` | Self-signed JWT for service auth (Google service accounts, Apple App Store Connect) |
| 6 | `bearer-token` | `strategies/bearer-token.ts` | Static bearer tokens (legacy APIs) |
| 7 | `basic-auth` | `strategies/basic-auth.ts` | HTTP Basic (legacy ERPs, on-prem SOAP) |
| 8 | `mutual-tls` | `strategies/mtls.ts` | Client-certificate auth (banks, government systems) |

Two additional strategies are supported but require a platform review:

| # | Strategy | Plugin file | Use case |
|---|---|---|---|
| 9 | `signed-requests` | `strategies/signed-requests.ts` | HMAC-signed requests (AWS SigV4, Acme custom signing) |
| 10 | `custom` | `strategies/custom.ts` | Connector-supplied plugin (loaded from the connector bundle) |

The `custom` strategy is reserved for cases where none of the nine built-ins fit (e.g. a proprietary SSO with a challenge-response dance). The plugin code is reviewed by the platform security team and shipped inside the connector bundle; the runtime loads it via `@eks/runtime`'s sandboxed `require()`.

---

## 2. Credential Storage

### 2.1 The `ConnectorCredential` model

```prisma
model ConnectorCredential {
  id              String   @id @default(cuid())
  configId        String   // → ConnectorConfiguration.id
  organizationId  String   // tenant scope (denormalised for query efficiency)
  // The secret name (e.g. "ACME_API_KEY", "ACME_API_SECRET", "ACME_WEBHOOK_SECRET")
  key             String
  // The encrypted value (AES-256-GCM envelope; never plaintext)
  encryptedValue  String
  // The key version used to encrypt (for rotation)
  keyVersion      Int      @default(1)
  // Whether this credential is currently active (one active per key per config)
  active          Boolean  @default(true)
  // Optional: when this credential expires (for time-bound tokens)
  expiresAt       DateTime?
  // Audit fields
  createdBy       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  config          ConnectorConfiguration @relation(fields: [configId], references: [id], onDelete: Cascade)

  @@unique([configId, key, active])
  @@index([configId])
  @@index([organizationId])
  @@index([expiresAt])
}
```

The `encryptedValue` is an AES-256-GCM envelope produced by `@eks/security/crypto.encrypt(plaintext, keyVersion)`:

```
base64( iv(12 bytes) || ciphertext || tag(16 bytes) )
```

The master key is held in the M2 `@eks/security` key store (KMS-backed in production; env-var-backed in dev). The `keyVersion` field tracks which master-key version was used; rotation is performed by re-encrypting every `ConnectorCredential` with the new key version (see §5).

### 2.2 The `SecretReference` model

Some secrets are shared across connectors — e.g. a tenant's Payswap API key is used by the Payswap connector, the Accounting Export connector, and the Refunds connector. Storing a copy in each `ConnectorCredential` row would multiply the rotation surface. Instead, the platform provides `SecretReference`:

```prisma
model SecretReference {
  id              String   @id @default(cuid())
  organizationId  String   // tenant scope
  // The human-readable name (e.g. "payswap-live-key", "acme-shared-secret")
  name            String
  // The encrypted value (AES-256-GCM envelope; same shape as ConnectorCredential.encryptedValue)
  encryptedValue  String
  keyVersion      Int      @default(1)
  // The list of connector codes that may resolve this secret
  // (JSON array; enforced by the runtime at resolve time)
  allowedConnectors String @default("[]")
  // Whether this secret is currently active
  active          Boolean  @default(true)
  // The rotation policy (cron or interval; null = manual)
  rotationPolicy  String?
  lastRotatedAt   DateTime?
  nextRotationAt  DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([organizationId, name])
  @@index([organizationId, active])
  @@index([nextRotationAt])
}
```

A connector references a `SecretReference` by name in its manifest:

```json5
{
  requiredSecrets: [
    { kind: "credential", name: "ACME_WEBHOOK_SECRET" },          // stored on ConnectorCredential
    { kind: "reference", name: "payswap-live-key" },              // resolved via SecretReference
  ],
}
```

At invocation time, `ctx.sdk.secrets.get("payswap-live-key")`:
1. Looks up the `SecretReference` by `(organizationId, name)`.
2. Verifies the connector's `code` is in `allowedConnectors`.
3. Decrypts the value with `keyVersion`.
4. Returns the plaintext to the connector sandbox.

The plaintext never leaves the sandbox; it is not logged, not persisted, not returned by any API. The `/api/v1/integrations/secrets` routes return **metadata only** (id, name, active, lastRotatedAt, nextRotationAt) — never the value.

### 2.3 Why not just store plaintext in the database?

Three reasons:
1. **Compliance** — PCI-DSS, GDPR, and the M2 `AUDIT_AND_COMPLIANCE.md` framework require encryption-at-rest for credentials. A database dump must not reveal usable secrets.
2. **Blast radius** — If the database is compromised, the attacker gets ciphertext; the master key lives in KMS, behind IAM. Re-encrypting after a key compromise is faster than rotating every credential on every connector.
3. **Auditability** — Every `ConnectorCredential` and `SecretReference` write goes through `@eks/security/crypto.encrypt`, which logs a `Secret.Accessed` event to the M2 `AuditLog` with `category="INTEGRATION"` and the credential id (not the value). The audit log is tamper-evident (M2 hash chain).

---

## 3. Code Examples — Each Strategy

### 3.1 API Keys (`api-key`)

The simplest strategy. The connector declares:

```json5
{ connector: { auth: { strategy: "api-key", header: "X-API-Key", secretName: "ACME_API_KEY" } } }
```

The plugin:

```typescript
// src/packages/integration/auth/strategies/api-key.ts
export const apiKeyStrategy = {
  async authenticate(config, credentials, _ctx) {
    const key = credentials[config.auth.secretName] as string;
    if (!key) return { ok: false, detail: "missing_api_key" };
    return { ok: true, authContext: { headers: { [config.auth.header]: key } } };
  },
};
```

The runtime caches the auth context (the headers) and merges it into every `ctx.sdk.apis.request` call. The connector's `authenticate()` method is bypassed.

### 3.2 OAuth2 — Authorization Code (`oauth2-authorization-code`)

Used when the connector needs to act on behalf of a user (e.g. read a user's Google Sheets). The user performs a one-time OAuth dance in the Integration Console; the platform stores the resulting `access_token` and `refresh_token` in `ConnectorCredential`.

```json5
{
  connector: {
    auth: {
      strategy: "oauth2-authorization-code",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
      redirectPath: "/api/v1/integrations/oauth/callback/google-sheets",
      pkce: true,
    },
  },
}
```

The plugin implements the standard three-legged flow:

```typescript
// src/packages/integration/auth/strategies/oauth2-auth-code.ts
export const oauth2AuthCodeStrategy = {
  buildAuthorizeUrl(config, state, codeChallenge) {
    const u = new URL(config.auth.authorizeUrl);
    u.searchParams.set("client_id", config.credentials.CLIENT_ID);
    u.searchParams.set("redirect_uri", config.credentials.REDIRECT_URI);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", config.auth.scopes.join(" "));
    u.searchParams.set("state", state);
    if (config.auth.pkce && codeChallenge) {
      u.searchParams.set("code_challenge", codeChallenge);
      u.searchParams.set("code_challenge_method", "S256");
    }
    return u.toString();
  },

  async exchangeCodeForToken(config, code, codeVerifier) {
    const res = await fetch(config.auth.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.credentials.REDIRECT_URI,
        client_id: config.credentials.CLIENT_ID,
        client_secret: config.credentials.CLIENT_SECRET,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      }),
    });
    if (!res.ok) throw new Error(`oauth2_token_exchange_failed: HTTP ${res.status}`);
    const body = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    return body;
  },

  async authenticate(config, credentials, _ctx) {
    // The credentials are the stored tokens; just verify they're present.
    if (!credentials.access_token) return { ok: false, detail: "missing_access_token" };
    return {
      ok: true,
      authContext: { headers: { Authorization: `Bearer ${credentials.access_token}` } },
      expiresAt: Date.now() + (credentials.expires_in ?? 3600) * 1000,
    };
  },
};
```

The Integration Console orchestrates the user-facing dance: it generates a PKCE code verifier, builds the authorize URL, redirects the user, receives the callback at `/api/v1/integrations/oauth/callback/:slug`, exchanges the code for tokens, and persists them to `ConnectorCredential`. The connector author does not implement any of this — only the manifest declaration.

### 3.3 OAuth2 — Client Credentials (`oauth2-client-credentials`)

Machine-to-machine. The connector's `authenticate()` (or the plugin) calls the token endpoint with `grant_type=client_credentials` and caches the result. See `CONNECTOR_DEVELOPMENT.md` §3.4 for the full example.

The plugin caches the token in Redis with `key=auth:{credentialId}`, `ttl=expires_in - 60`. A pre-emptive refresh runs at 60s before expiry; if the refresh fails, the cached token is used until expiry, at which point the next invocation triggers a synchronous refresh (blocking the call for ~200ms).

### 3.4 OAuth2 — Refresh (`oauth2-refresh`)

A sub-strategy used by `oauth2-authorization-code` to refresh expired access tokens. The plugin:

```typescript
async refresh(config, credentials) {
  const res = await fetch(config.auth.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refresh_token,
      client_id: config.credentials.CLIENT_ID,
      client_secret: config.credentials.CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    if (res.status === 400) {
      // The refresh token is invalid — the user must re-authorise.
      throw new Error("oauth2_refresh_token_invalid");
    }
    throw new Error(`oauth2_refresh_failed: HTTP ${res.status}`);
  }
  const body = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
  // Some providers rotate the refresh token on each use (e.g. Google).
  // The runtime persists the new tokens to ConnectorCredential in the same tx.
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? credentials.refresh_token,
    expires_in: body.expires_in,
  };
}
```

If `oauth2_refresh_token_invalid` is thrown, the runtime transitions the `ConnectorConfiguration` to `ERROR` with `lastError="auth_refresh_required"` and emits `Connector.AuthExpired` to the `EventOutbox`. The Integration Console shows a "Re-authorise" button; the user repeats the OAuth dance and the new tokens are persisted.

### 3.5 JWT Bearer (`jwt-bearer`)

Used by Google service accounts and Apple App Store Connect. The connector holds a private key (stored in `ConnectorCredential` as a PEM); the plugin signs a short-lived JWT and exchanges it for an access token.

```typescript
// src/packages/integration/auth/strategies/jwt-bearer.ts
import { sign } from "node:crypto"; // simplified; real impl uses jsonwebtoken or jose

export const jwtBearerStrategy = {
  async authenticate(config, credentials, _ctx) {
    const privateKey = credentials.PRIVATE_KEY_PEM as string;
    const serviceAccountEmail = config.credentials.CLIENT_EMAIL as string;
    const tokenUrl = config.auth.tokenUrl; // e.g. https://oauth2.googleapis.com/token

    const now = Math.floor(Date.now() / 1000);
    const assertion = sign(
      {
        header: { alg: "RS256", typ: "JWT", kid: config.credentials.PRIVATE_KEY_ID },
        payload: {
          iss: serviceAccountEmail,
          scope: config.auth.scopes.join(" "),
          aud: tokenUrl,
          iat: now,
          exp: now + 3600,
        },
      },
      privateKey,
      { algorithm: "RS256" },
    );

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!res.ok) throw new Error(`jwt_bearer_failed: HTTP ${res.status}`);
    const body = await res.json() as { access_token: string; expires_in: number };

    return {
      ok: true,
      authContext: { headers: { Authorization: `Bearer ${body.access_token}` } },
      expiresAt: Date.now() + body.expires_in * 1000,
    };
  },
};
```

The private key is the most sensitive credential type. The runtime never logs it; the `Secret.Accessed` audit entry records only `key="PRIVATE_KEY_PEM"`, never the value. Key rotation is via the `POST /api/v1/integrations/connectors/:id/credentials/:cid/rotate` route (see §5).

### 3.6 Bearer Token (`bearer-token`)

Static bearer tokens — legacy APIs that issue a long-lived token out-of-band. The plugin is identical to `api-key` except the header is always `Authorization: Bearer <token>`.

```typescript
export const bearerTokenStrategy = {
  async authenticate(config, credentials, _ctx) {
    const token = credentials.BEARER_TOKEN as string;
    if (!token) return { ok: false, detail: "missing_bearer_token" };
    return { ok: true, authContext: { headers: { Authorization: `Bearer ${token}` } } };
  },
};
```

Static tokens have no expiry; the platform cannot detect a stale token until the upstream returns `401`. The runtime treats a `401` from any upstream as an `AUTH_FAILED` (per `@eks/connector-sdk/errors`), which is non-retryable, transitions the `ConnectorConfiguration` to `ERROR`, and emits `Connector.AuthFailed`. The operator must rotate the token manually.

### 3.7 Basic Auth (`basic-auth`)

```typescript
export const basicAuthStrategy = {
  async authenticate(config, credentials, _ctx) {
    const username = credentials.USERNAME as string;
    const password = credentials.PASSWORD as string;
    if (!username || !password) return { ok: false, detail: "missing_basic_credentials" };
    const encoded = Buffer.from(`${username}:${password}`).toString("base64");
    return { ok: true, authContext: { headers: { Authorization: `Basic ${encoded}` } } };
  },
};
```

Basic auth is discouraged for new connectors but supported for legacy ERPs and on-prem SOAP services. The platform enforces TLS for every basic-auth request (the egress proxy refuses plain-HTTP calls when the connector declares `auth.strategy="basic-auth"`).

### 3.8 Mutual TLS (`mutual-tls`)

```typescript
export const mtlsStrategy = {
  async authenticate(config, credentials, _ctx) {
    const cert = credentials.CLIENT_CERT_PEM as string;
    const key = credentials.CLIENT_KEY_PEM as string;
    const ca = credentials.CA_CERT_PEM as string;
    if (!cert || !key) return { ok: false, detail: "missing_mtls_material" };
    // The runtime injects these into the https.Agent used by ctx.sdk.apis.request.
    return {
      ok: true,
      authContext: { tls: { cert, key, ca } },
    };
  },
};
```

The runtime's egress proxy constructs a per-connector `https.Agent` with the supplied material; every subsequent `ctx.sdk.apis.request` call to a `mutual-tls` connector uses that agent. The CA bundle is pinned (no system trust store), preventing MITM via rogue CAs. Certificates have expiry; the platform tracks `ConnectorCredential.expiresAt` and emits `Secret.ExpiringSoon` (default 30 days before expiry) so the operator can rotate.

### 3.9 Signed Requests (`signed-requests`)

For HMAC-signed requests (AWS SigV4, Acme's custom signing). The plugin signs every outgoing request:

```typescript
export const signedRequestsStrategy = {
  async authenticate(config, credentials, _ctx) {
    const secret = credentials.SIGNING_SECRET as string;
    const keyId = credentials.SIGNING_KEY_ID as string;
    return { ok: true, authContext: { signer: { kind: "hmac-sha256", secret, keyId } } };
  },

  async signRequest(authContext, request) {
    const { secret, keyId } = authContext.signer;
    const canonical = buildCanonicalRequest(request); // method, path, sorted query, headers, body hash
    const stringToSign = [
      "EKS-HMAC-SHA256",
      request.timestamp,
      hash(canonical),
    ].join("\n");
    const signature = createHmac("sha256", secret).update(stringToSign).digest("hex");
    request.headers["X-Eks-KeyId"] = keyId;
    request.headers["X-Eks-Timestamp"] = request.timestamp;
    request.headers["X-Eks-Signature"] = signature;
    return request;
  },
};
```

The runtime calls `signRequest` for every `ctx.sdk.apis.request` made by a connector that declares `signed-requests`. The connector code is unaware of signing — it just makes normal HTTP calls.

### 3.10 Custom Authentication Plugins (`custom`)

When none of the nine built-ins fit (e.g. a proprietary challenge-response, multi-step SSO), the connector ships its own plugin:

```typescript
// src/auth-plugin.ts (inside the connector bundle)
import type { AuthPlugin } from "@eks/integration";

export default <AuthPlugin>{
  name: "acme-sso",
  async authenticate(config, credentials, ctx) {
    // 1. Fetch a challenge from Acme
    const challengeRes = await ctx.sdk.apis.request(`${config.acmeBaseUrl}/sso/challenge`, {
      method: "POST",
      body: JSON.stringify({ client_id: credentials.ACME_API_KEY }),
    });
    const { nonce } = await challengeRes.json();

    // 2. Sign the challenge with the API secret
    const signature = createHmac("sha256", credentials.ACME_API_SECRET).update(nonce).digest("hex");

    // 3. Exchange the signed challenge for a session token
    const tokenRes = await ctx.sdk.apis.request(`${config.acmeBaseUrl}/sso/token`, {
      method: "POST",
      body: JSON.stringify({ nonce, signature }),
    });
    const { token, expires_in } = await tokenRes.json();

    return {
      ok: true,
      authContext: { headers: { "X-Acme-Session": token } },
      expiresAt: Date.now() + expires_in * 1000,
    };
  },
};
```

The manifest declares:

```json5
{ connector: { auth: { strategy: "custom", pluginPath: "./auth-plugin.js" } } }
```

The runtime loads the plugin from the connector bundle inside the sandbox; the plugin has the same capabilities as a built-in (access to `ctx.sdk.apis.request`, `ctx.sdk.secrets.get`, `ctx.log`). Custom plugins are subject to platform security review at publish time (the M3 registry pipeline flags `auth.strategy === "custom"` for human review).

---

## 4. Credential Rotation

### 4.1 Manual rotation

```
POST /api/v1/integrations/connectors/:id/credentials/:cid/rotate
{
  "value": "<new-plaintext-value>"
}
```

The route:
1. Authorises the caller (`integration.secrets.rotate` permission).
2. Encrypts the new value with the current `keyVersion`.
3. Creates a **new** `ConnectorCredential` row (`active=true`).
4. Marks the old row `active=false` (soft-delete — retained for 90 days for forensic purposes).
5. Invokes the connector's `authenticate()` to validate the new credential. If validation fails, the new row is deleted and the old row is re-activated (atomic).
6. Emits `Secret.Rotated` to the `EventOutbox` (consumed by `@eks/notifications` to alert the operator, `@eks/observability/audit` to write the audit-log entry).
7. Returns the new credential metadata (id, active, lastRotatedAt).

### 4.2 Scheduled rotation

A `SecretReference` with `rotationPolicy="0 0 1 * *"` (cron — first of the month at midnight) is rotated automatically by the scheduler. The scheduler invokes the connector's `rotateSecret()` method (optional; if not implemented, the platform emails the operator a reminder 7 days before `nextRotationAt`). When a connector implements `rotateSecret()`:

```typescript
async function rotateSecret(ctx: ConnectorContext): Promise<{ newEncryptedValue: string }> {
  // 1. Use the current credential to call the upstream's "issue new key" endpoint
  // 2. Return the new plaintext; the runtime encrypts and persists it
  const newKey = await callAcmeRotateEndpoint(ctx);
  return { newEncryptedValue: newKey };
}
```

### 4.3 Key-version rotation (master key)

The master key in KMS is rotated annually. The rotation procedure:
1. Generate a new master key in KMS (`keyVersion = N+1`).
2. Update `EKS_SECURITY_MASTER_KEY_VERSION=N+1` in the platform config.
3. The runtime uses `keyVersion=N+1` for all new writes.
4. A background job (`@eks/integration/secrets.reencrypt-job.ts`) iterates every `ConnectorCredential` and `SecretReference` with `keyVersion < N+1`, decrypts with the old key, re-encrypts with the new key, and updates the row.
5. Once the job completes (typically <1h for 50k connectors), the old key is marked `DEPRECATED` in KMS (still available for reads of any pre-rotation backups; purged after 90 days).

The job is idempotent and resumable; a crash mid-rotation leaves a mix of `keyVersion=N` and `keyVersion=N+1` rows, both of which decrypt correctly (the runtime tries the row's `keyVersion` first).

---

## 5. Scoped Access

### 5.1 Per-credential scoping

A `ConnectorCredential` may declare a `scope` (JSON array) that constrains what the credential can do at the upstream. The platform cannot enforce upstream-side scoping, but it can:

- **Refuse to issue** a credential whose `scope` exceeds the connector's declared `requiredScopes` in the manifest (e.g. a connector that only needs `orders:read` cannot be given a credential with `orders:write`).
- **Audit** every `ctx.sdk.apis.request` call with the credential's scope attached, so a post-incident review can confirm scope-of-use.

### 5.2 Per-connector scoping (`allowedConnectors`)

A `SecretReference` declares `allowedConnectors: ["payswap", "accounting-export", "refunds"]`. The runtime refuses to resolve the secret for any connector whose `code` is not in the list. This prevents a compromised or buggy connector from exfiltrating a tenant's shared Payswap key.

### 5.3 Per-tenant scoping

Every `ConnectorCredential` and `SecretReference` has an `organizationId`. The M2 `TenantContext` ALS propagates the tenant id into every Prisma query, so a tenant's credential cannot be resolved by another tenant's connector (even if the connector code is shared).

---

## 6. Auth Failure Handling

When `authenticate()` returns `{ ok: false }` or throws, the runtime:

1. Does **not** retry (auth failures are not transient — retrying with the same credential burns through rate limits).
2. Records a `ConnectorExecution` row (`kind="AUTH"`, `status="FAILED"`, `errorMessage=<detail>`).
3. If 3 consecutive auth failures occur, transitions the `ConnectorConfiguration` to `ERROR` with `lastError="auth_failed"`.
4. Emits `Connector.AuthFailed` to the `EventOutbox`.
5. `@eks/notifications` dispatches an alert to the tenant's Integration Console and (if configured) to the operator's email/Slack.
6. The connector stays in `ERROR` until the operator rotates the credential via the `/rotate` route.

If the upstream returns `401` mid-sync (i.e. the credential was valid at `authenticate()` time but expired mid-invocation), the runtime:
1. Marks the in-flight `SynchronizationJob` as `FAILED` with `errorMessage="auth_expired_mid_sync"`.
2. Re-runs `authenticate()` to refresh the token (for OAuth2 strategies).
3. If the refresh succeeds, restarts the sync from the last `SynchronizationCheckpoint`.
4. If the refresh fails, transitions to `ERROR` as above.

---

## 7. End-to-End Auth Audit Trail

Every auth-related action produces an `AuditLog` row with `category="INTEGRATION"`:

| Action | Audit code | Fields |
|---|---|---|
| Credential added | `INTEGRATION_CREDENTIAL_ADDED` | `configId`, `key`, `keyVersion`, `actorId` |
| Credential rotated | `INTEGRATION_CREDENTIAL_ROTATED` | `configId`, `key`, `oldCredentialId`, `newCredentialId`, `actorId` |
| Credential deactivated | `INTEGRATION_CREDENTIAL_DEACTIVATED` | `configId`, `key`, `actorId` |
| Secret resolved at runtime | `INTEGRATION_SECRET_ACCESSED` | `secretReferenceId` or `credentialId`, `connectorCode`, `invocationId` (never the value) |
| Auth failed | `INTEGRATION_AUTH_FAILED` | `configId`, `strategy`, `detail` |
| Master key rotated | `INTEGRATION_MASTER_KEY_ROTATED` | `oldKeyVersion`, `newKeyVersion`, `actorId` |
| SecretReference scope changed | `INTEGRATION_SECRET_SCOPE_CHANGED` | `secretReferenceId`, `oldAllowedConnectors`, `newAllowedConnectors`, `actorId` |

The audit log is queryable via `GET /api/v1/audit?category=INTEGRATION&from=...&to=...` and is retained for 7 years per the M2 retention policy (`docs/identity/AUDIT_AND_COMPLIANCE.md` §6).

---

## 8. Common Auth Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Storing tokens in `ctx.config.credentials` directly | Tokens lost on sandbox exit | Use the auth-context cache (Redis) via the strategy plugin — the runtime manages persistence |
| Logging the credential value | Plaintext in logs | `ctx.log` redacts known-sensitive keys (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_PEM`); never log `ctx.config.credentials` as a whole |
| Hardcoding redirect URIs | OAuth callback fails in different environments | Use `${EKS_PUBLIC_BASE_URL}/api/v1/integrations/oauth/callback/:slug` from the platform config |
| Reusing the same client_secret across connectors | One compromise → all connectors compromised | One `ConnectorCredential` per (config, key) pair; share via `SecretReference` only when truly shared |
| Using basic-auth over HTTP | Plaintext credentials on the wire | The egress proxy refuses plain-HTTP for `basic-auth` connectors; use TLS or switch to `api-key` over TLS |
| Not handling `401` mid-sync | Sync hangs in `RUNNING` forever | The runtime auto-refreshes on `401`; if your strategy is `custom`, implement `refresh()` alongside `authenticate()` |
| Refreshing tokens inside `poll()` | Burn through rate limits when tokens expire | The strategy plugin handles refresh centrally — `poll()` should assume a valid token |

When in doubt, run `bunx @eks/dev-cli validate --auth` — it static-analyes the connector for these pitfalls.
