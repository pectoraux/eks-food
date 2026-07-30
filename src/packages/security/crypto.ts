/** AES-256-GCM authenticated encryption. Keys derived via PBKDF2. */
import { Buffer } from "node:buffer";

// Use the global Web Crypto API (available in Node 18+ / Bun / browsers) so the
// CryptoKey and BufferSource types align with the DOM lib declarations.
const subtle = globalThis.crypto.subtle;
const PBKDF2_ITERATIONS = 150_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedPayload {
  readonly ciphertext: string; // base64
  readonly iv: string; // base64
  readonly salt: string; // base64
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase) as unknown as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encrypt(plaintext: string, passphrase: string): Promise<EncryptedPayload> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as unknown as BufferSource
  );
  return {
    ciphertext: Buffer.from(ciphertext).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
    salt: Buffer.from(salt).toString("base64"),
  };
}

export async function decrypt(payload: EncryptedPayload, passphrase: string): Promise<string> {
  const salt = Buffer.from(payload.salt, "base64");
  const iv = Buffer.from(payload.iv, "base64");
  const key = await deriveKey(passphrase, salt);
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const plaintext = await subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    ciphertext as unknown as BufferSource
  );
  return Buffer.from(plaintext).toString("utf8");
}

/** Convenience: derive a 32-byte key directly (for HMAC signing etc.). */
export async function deriveSigningKey(passphrase: string, salt: string): Promise<Uint8Array> {
  const saltBytes = new TextEncoder().encode(salt);
  const key = await deriveKey(passphrase, saltBytes);
  const raw = await subtle.exportKey("raw", key);
  return new Uint8Array(raw);
}
