/**
 * Extension storage — namespaced key/value + document storage.
 * Every key is automatically prefixed with `ext:{extensionId}:{orgId}:` so
 * extensions cannot read or write each other's data.
 */
import { db } from "@/lib/db";
import { encrypt, decrypt } from "@eks/security";

export class ExtensionStorage {
  constructor(
    private readonly extensionId: string,
    private readonly organizationId: string
  ) {}

  private ns(key: string): string {
    return `ext:${this.extensionId}:${this.organizationId}:${key}`;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const record = await db.extensionLog.findFirst({
      where: { extensionId: this.extensionId, organizationId: this.organizationId, metadata: { contains: this.ns(key) } },
    }).catch(() => null);
    // Use a dedicated KV approach via the Secret model pattern — but for the
    // foundation milestone, we store extension KV in an in-memory map keyed by
    // the namespaced key. Production swaps to a dedicated KV table or Redis.
    return _kv.get(this.ns(key)) as T | null;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    _kv.set(this.ns(key), value, ttlMs);
  }

  async delete(key: string): Promise<void> {
    _kv.delete(this.ns(key));
  }

  async keys(prefix?: string): Promise<readonly string[]> {
    const full = this.ns(prefix ?? "");
    return _kv.keys(full);
  }
}

// In-memory KV store for the foundation milestone. Production swaps to Redis
// or a dedicated extension_kv table. Values are namespaced per extension+tenant.
class KVStore {
  private readonly map = new Map<string, { value: unknown; expiresAt: number | null }>();

  get(key: string): unknown {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: unknown, ttlMs?: number): void {
    this.map.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : null });
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  keys(prefix: string): readonly string[] {
    return Array.from(this.map.keys()).filter((k) => k.startsWith(prefix));
  }
}

const _kv = new KVStore();

/** Encrypt a value before storing (for sensitive extension data). */
export async function encryptValue(plaintext: string, secret: string): Promise<string> {
  const payload = await encrypt(plaintext, secret);
  return JSON.stringify(payload);
}

/** Decrypt a stored value. */
export async function decryptValue(encrypted: string, secret: string): Promise<string> {
  const payload = JSON.parse(encrypted);
  return decrypt(payload, secret);
}
