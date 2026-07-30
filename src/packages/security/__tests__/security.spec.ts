import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../crypto";
import { signCookie, verifyCookie, cookieHeader } from "../cookies";
import { sanitizeString, sanitizeHtml, containsSqlInjectionPattern } from "../sanitization";
import { hasPermission, authorize, type Principal } from "../rbac";
import { ForbiddenError } from "@eks/errors";

const SECRET = "test-secret-key-at-least-16-chars";

describe("crypto", () => {
  it("encrypts and decrypts round-trip", async () => {
    const plaintext = "sensitive payment reference pi_12345";
    const payload = await encrypt(plaintext, SECRET);
    expect(payload.ciphertext).not.toContain(plaintext);
    expect(payload.iv).not.toBe(payload.salt);
    const decrypted = await decrypt(payload, SECRET);
    expect(decrypted).toBe(plaintext);
  });

  it("fails with wrong passphrase", async () => {
    const payload = await encrypt("secret", SECRET);
    await expect(decrypt(payload, "wrong-passphrase-different")).rejects.toThrow();
  });

  it("produces unique ciphertexts for same plaintext (random IV/salt)", async () => {
    const a = await encrypt("same", SECRET);
    const b = await encrypt("same", SECRET);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.salt).not.toBe(b.salt);
  });
});

describe("cookies", () => {
  it("signs and verifies a cookie", async () => {
    const signed = await signCookie("session=abc123", SECRET);
    expect(await verifyCookie(signed, SECRET)).toBe("session=abc123");
  });
  it("rejects tampered cookies", async () => {
    const signed = await signCookie("session=abc", SECRET);
    const tampered = signed.slice(0, -2) + "XX";
    expect(await verifyCookie(tampered, SECRET)).toBeNull();
  });
  it("cookieHeader includes secure attributes", async () => {
    const h = cookieHeader("sid", await signCookie("v", SECRET), { secure: true, httpOnly: true });
    expect(h).toContain("HttpOnly");
    expect(h).toContain("Secure");
    expect(h).toContain("SameSite=lax");
  });
});

describe("sanitization", () => {
  it("strips control characters", () => {
    expect(sanitizeString("hello\u0000world")).toBe("helloworld");
  });
  it("escapes HTML", () => {
    expect(sanitizeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
  it("detects SQL injection patterns", () => {
    expect(containsSqlInjectionPattern("'; DROP TABLE users; --")).toBe(true);
    expect(containsSqlInjectionPattern("hello world")).toBe(false);
  });
});

describe("rbac", () => {
  const admin: Principal = { userId: "u1", organizationId: "o1", name: "Admin", roles: ["SUPER_ADMIN"] };
  const customer: Principal = { userId: "u2", organizationId: "o1", name: "Cust", roles: ["CUSTOMER"] };

  it("grants admin.config to SUPER_ADMIN", () => {
    expect(hasPermission(admin, "admin.config")).toBe(true);
    expect(() => authorize(admin, "admin.config")).not.toThrow();
  });
  it("denies admin.config to CUSTOMER", () => {
    expect(hasPermission(customer, "admin.config")).toBe(false);
    expect(() => authorize(customer, "admin.config")).toThrow(ForbiddenError);
  });
  it("grants booking.create to CUSTOMER", () => {
    expect(hasPermission(customer, "booking.create")).toBe(true);
  });
});
