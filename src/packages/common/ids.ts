/** Branded primitive types & id generation. */

/** A UUID v4 string. Branded so it can't be confused with arbitrary strings. */
export type UUID = string & { readonly __brand: "UUID" };

/** ISO-8601 date string, e.g. `2026-07-28T12:00:00.000Z`. */
export type ISODateString = string & { readonly __brand: "ISODateString" };

/** Brand a plain string into a nominal type. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Generate a UUID v4, branded. Uses the Web Crypto API. */
export function uuid(): UUID {
  return crypto.randomUUID() as UUID;
}

/** Coerce a string to UUID (no validation beyond shape — validate at boundaries). */
export function asUUID(s: string): UUID {
  return s as UUID;
}

/** Coerce a string/date to an ISODateString. */
export function asISODate(d: string | Date): ISODateString {
  return (typeof d === "string" ? d : d.toISOString()) as ISODateString;
}

/** A short, URL-safe, lowercase id (e.g. for booking codes / correlation). 12 chars. */
export function shortId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return toBase36(bytes).slice(0, 12);
}

/** Generate a human-friendly reference code, e.g. `EKS-7F3K9Q`. */
export function referenceCode(prefix = "EKS"): string {
  return `${prefix}-${shortId().slice(0, 6).toUpperCase()}`;
}

/** An idempotency key suitable for Payswap/Stripe-style APIs. */
export function idempotencyKey(prefix = "idmp"): string {
  return `${prefix}_${shortId()}${Date.now().toString(36)}`;
}

function toBase36(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(36).padStart(2, "0");
  }
  return out;
}
