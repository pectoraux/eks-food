/** Password hashing with Argon2id — the OWASP-recommended algorithm.
 * Parameters: memory 19456 KiB, iterations 2, parallelism 1 (OWASP minimums). */
import argon2 from "argon2";

export type PasswordHash = string;

export async function hashPassword(plaintext: string): Promise<PasswordHash> {
  if (plaintext.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  return argon2.hash(plaintext, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: PasswordHash, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}
