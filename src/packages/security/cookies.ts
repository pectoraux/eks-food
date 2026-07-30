/** Secure (signed) cookie helpers. */
import { webcrypto } from "node:crypto";

export interface CookieOptions {
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: "strict" | "lax" | "none";
  readonly maxAgeMs?: number;
  readonly path?: string;
  readonly domain?: string;
}

const subtle = webcrypto.subtle;

export async function signCookie(value: string, secret: string): Promise<string> {
  const key = await subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return `${value}.${Buffer.from(sig).toString("base64url")}`;
}

export async function verifyCookie(signed: string, secret: string): Promise<string | null> {
  const idx = signed.lastIndexOf(".");
  if (idx < 1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = await signCookie(value, secret);
  const expectedSig = expected.slice(expected.lastIndexOf(".") + 1);
  // Constant-time comparison.
  if (sig.length !== expectedSig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  return diff === 0 ? value : null;
}

export function cookieHeader(name: string, signedValue: string, opts: CookieOptions = {}): string {
  const parts = [`${name}=${signedValue}`];
  if (opts.httpOnly ?? true) parts.push("HttpOnly");
  if (opts.secure ?? true) parts.push("Secure");
  parts.push(`SameSite=${opts.sameSite ?? "lax"}`);
  if (opts.maxAgeMs) parts.push(`Max-Age=${Math.floor(opts.maxAgeMs / 1000)}`);
  parts.push(`Path=${opts.path ?? "/"}`);
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  return parts.join("; ");
}

export function clearCookieHeader(name: string, path = "/"): string {
  return `${name}=; Max-Age=0; Path=${path}; HttpOnly; Secure; SameSite=lax`;
}
