/** Input sanitization — defense-in-depth alongside Zod validation. */

const SQL_PATTERNS = [
  /(\b(union|select|insert|update|delete|drop|alter|create|exec)\b.*\b(from|into|table|database)\b)/i,
  /(--\s)/,
  /(;.*(;|\z))/i,
];

/** Strip control characters & normalize unicode. */
export function sanitizeString(input: string, maxLength = 10_000): string {
  return input.slice(0, maxLength).replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

/** Escape HTML special characters (for output encoding, never trust-input). */
export function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Heuristic SQL-injection pattern detection (defense-in-depth; Zod is the primary control). */
export function containsSqlInjectionPattern(input: string): boolean {
  return SQL_PATTERNS.some((p) => p.test(input));
}
