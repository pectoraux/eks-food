import { NextRequest } from "next/server";
import { success } from "@eks/api/response";
import { apiHandler } from "@eks/api/handler";
import { createConfig } from "@eks/config";
import { isProduction } from "@eks/config";

export const dynamic = "force-dynamic";

interface PackageInfo {
  name: string;
  path: string;
  responsibility: string;
  status: "operational";
}

const PACKAGES: readonly PackageInfo[] = [
  { name: "@eks/common", path: "src/packages/common", responsibility: "Ids, Money, Date, Pagination, Result, Retry, CircuitBreaker", status: "operational" },
  { name: "@eks/config", path: "src/packages/config", responsibility: "Validated, strongly-typed, fail-fast configuration", status: "operational" },
  { name: "@eks/errors", path: "src/packages/errors", responsibility: "Canonical error hierarchy + RFC 7807 problem+json", status: "operational" },
  { name: "@eks/observability", path: "src/packages/observability", responsibility: "Structured logging, metrics, tracing, health, audit", status: "operational" },
  { name: "@eks/events", path: "src/packages/events", responsibility: "Event bus, transactional outbox, DLQ, replay, idempotency", status: "operational" },
  { name: "@eks/cache", path: "src/packages/cache", responsibility: "Redis abstraction, locks, stampede protection, patterns", status: "operational" },
  { name: "@eks/features", path: "src/packages/features", responsibility: "Feature flags with rollout & per-org overrides", status: "operational" },
  { name: "@eks/api", path: "src/packages/api", responsibility: "Handler wrapper, validation, rate-limit, idempotency, OpenAPI", status: "operational" },
  { name: "@eks/workers", path: "src/packages/workers", responsibility: "Job queue: retries, delays, priority, DLQ, idempotency", status: "operational" },
  { name: "@eks/security", path: "src/packages/security", responsibility: "AES-GCM crypto, signed cookies, sanitization, RBAC, headers", status: "operational" },
  { name: "@eks/payments", path: "src/packages/payments", responsibility: "Provider-agnostic PaymentProvider port (Payswap-ready)", status: "operational" },
  { name: "@eks/domain", path: "src/packages/domain", responsibility: "21 DDD bounded contexts (aggregates, repos, events, services)", status: "operational" },
  { name: "@eks/testing", path: "src/packages/testing", responsibility: "Factories, fixtures, assertions, mocks, http helpers", status: "operational" },
];

/** GET /api/v1/packages — inventory of the @eks/* internal package registry. */
export const GET = apiHandler(async (_req: NextRequest) => {
  let configOk = true;
  let configError: string | null = null;
  try {
    createConfig().load();
  } catch (e) {
    configOk = false;
    configError = e instanceof Error ? e.message : String(e);
  }
  return success({
    environment: process.env.NODE_ENV ?? "development",
    isProduction: isProduction(),
    packages: PACKAGES,
    config: { loaded: configOk, error: configError },
    boundedContexts: 21,
  });
});
