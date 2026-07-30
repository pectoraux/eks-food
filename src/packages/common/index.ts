/**
 * @eks/common — shared primitive utilities used across every Eks-Food package.
 *
 * Pure, dependency-free, side-effect-free. Safe to import from any layer
 * (domain, application, infrastructure, interface). No Prisma, no Next.js.
 */

export * from "./ids";
export * from "./money";
export * from "./date";
export * from "./pagination";
export * from "./result";
export * from "./retry";
export * from "./circuit-breaker";
export { type Maybe, type NonEmptyArray, type DeepReadonly, type Environment, type Listener, type Disposable } from "./types";
