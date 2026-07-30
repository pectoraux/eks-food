/** Packager — produces a signed, checksummed package artifact. */
import { createHash } from "node:crypto";

export interface PackageResult {
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly signature?: string;
  readonly artifactKey: string;
}

export class Packager {
  /**
   * Package an extension's source into an artifact.
   * In production: tar+zstd compression, Ed25519 signing, SHA-256 checksum.
   * Foundation milestone: compute checksum + size, generate a synthetic signature.
   */
  async pack(input: { extensionId: string; version: string; source: string; privateKey?: string }): Promise<PackageResult> {
    const checksum = createHash("sha256").update(input.source).digest("hex");
    const sizeBytes = Buffer.byteLength(input.source, "utf8");
    // Ed25519 signature (in production, sign the checksum with the publisher's private key).
    let signature: string | undefined;
    if (input.privateKey) {
      // Production: crypto.sign(null, Buffer.from(checksum), privateKey)
      // Foundation: synthetic signature derived from the checksum + key.
      signature = createHash("sha256").update(`${checksum}:${input.privateKey}`).digest("hex");
    }
    const artifactKey = `packages/${input.extensionId}/${input.version}.tar.zst`;
    return { checksum, sizeBytes, signature, artifactKey };
  }

  /** Verify a package's integrity (checksum + signature). */
  verify(input: { source: string; expectedChecksum: string; signature?: string; publicKey?: string }): { valid: boolean; signatureValid: boolean } {
    const actualChecksum = createHash("sha256").update(input.source).digest("hex");
    const checksumValid = actualChecksum === input.expectedChecksum;
    let signatureValid = true;
    if (input.signature && input.publicKey) {
      const expected = createHash("sha256").update(`${input.expectedChecksum}:${input.publicKey}`).digest("hex");
      signatureValid = expected === input.signature;
    }
    return { valid: checksumValid, signatureValid };
  }
}
