/**
 * @eks/registry — extension registry, manifest validation, packaging, publishing.
 *
 * The registry is the source of truth for extensions, their versions, manifests,
 * packages, and publishers. Validates manifests at install time, verifies
 * package signatures, and manages the publishing pipeline.
 */
export { ExtensionRegistry } from "./registry";
export { ManifestValidator, type ManifestValidationResult } from "./manifest";
export { Packager, type PackageResult } from "./packager";
export { Publisher, type PublishResult } from "./publisher";
export { type Manifest } from "./manifest";
