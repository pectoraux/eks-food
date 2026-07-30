import { db } from "@/lib/db";

/**
 * Idempotent seed for the Connector Platform: connector versions, credentials,
 * configurations, executions, health, schedules, sync jobs + checkpoints,
 * webhook endpoints + deliveries, polling jobs, schemas + mappings, policies.
 */
export async function seedIntegration(force = false) {
  if (force) {
    await db.secretReference.deleteMany();
    await db.rateLimitPolicy.deleteMany();
    await db.retryPolicy.deleteMany();
    await db.transformationRule.deleteMany();
    await db.mappingTemplate.deleteMany();
    await db.schemaVersion.deleteMany();
    await db.schemaDefinition.deleteMany();
    await db.pollingJob.deleteMany();
    await db.webhookDelivery.deleteMany();
    await db.webhookEndpoint.deleteMany();
    await db.synchronizationCheckpoint.deleteMany();
    await db.synchronizationJob.deleteMany();
    await db.connectorSchedule.deleteMany();
    await db.connectorHealth.deleteMany();
    await db.connectorExecutionV2.deleteMany();
    await db.connectorConfigurationV2.deleteMany();
    await db.connectorCredential.deleteMany();
    await db.connectorVersion.deleteMany();
  }

  const org = await db.organization.findFirst();
  if (!org) return { error: "no_org" };

  // 1. Connector versions (for the M3 connector definitions).
  const connectorDefs = await db.connectorDefinition.findMany();
  for (const cd of connectorDefs) {
    const existing = await db.connectorVersion.findFirst({ where: { connectorDefId: cd.id, version: "1.0.0" } });
    if (!existing) {
      await db.connectorVersion.create({
        data: {
          connectorDefId: cd.id,
          version: "1.0.0",
          manifest: JSON.stringify({ code: cd.code, capabilities: [] }),
          checksum: `sha256:${cd.code}${Date.now()}`,
          signature: `ed25519:${cd.code.slice(0, 8)}`,
          sizeBytes: 15000,
          status: "RELEASED",
          compatRange: ">=1.0.0",
          publishedAt: new Date(),
        },
      });
    }
  }

  // 2. Credentials (encrypted placeholder).
  const payswapDef = connectorDefs.find((c) => c.code === "payswap")!;
  const sheetsDef = connectorDefs.find((c) => c.code === "google-sheets")!;
  const twilioDef = connectorDefs.find((c) => c.code === "twilio-sms")!;

  const cred1 = (await db.connectorCredential.create({
    data: { organizationId: org.id, connectorDefId: payswapDef.id, name: "Payswap Production Key", authType: "API_KEY", encryptedData: JSON.stringify({ iv: "x", ciphertext: "y", salt: "z" }), active: true },
  }).catch(() => null)) ?? (await db.connectorCredential.findFirst({ where: { organizationId: org.id, connectorDefId: payswapDef.id } }))!;
  const cred2 = (await db.connectorCredential.create({
    data: { organizationId: org.id, connectorDefId: sheetsDef.id, name: "Google OAuth", authType: "OAUTH2", encryptedData: JSON.stringify({ iv: "x", ciphertext: "y", salt: "z" }), active: true, expiresAt: new Date(Date.now() + 3600000) },
  }).catch(() => null)) ?? (await db.connectorCredential.findFirst({ where: { organizationId: org.id, connectorDefId: sheetsDef.id } }))!;

  // 3. Configurations (V2).
  const configs: Record<string, string> = {};
  for (const [code, def, credId] of [["payswap", payswapDef, cred1.id], ["google-sheets", sheetsDef, cred2.id], ["twilio-sms", twilioDef, null]] as const) {
    const existing = await db.connectorConfigurationV2.findFirst({ where: { organizationId: org.id, connectorDefId: def.id } });
    if (!existing) {
      const cfg = await db.connectorConfigurationV2.create({
        data: { organizationId: org.id, connectorDefId: def.id, credentialId: credId, name: `${code} config`, config: "{}", status: "ACTIVE", syncState: JSON.stringify({ lastSyncAt: new Date().toISOString(), cursor: null }) },
      });
      configs[code] = cfg.id;
    } else {
      configs[code] = existing.id;
    }
  }

  // 4. Executions (sample history).
  const payswapConfigId = configs["payswap"];
  if (payswapConfigId) {
    const existingExecs = await db.connectorExecutionV2.count({ where: { configId: payswapConfigId } });
    if (existingExecs === 0) {
      for (let i = 0; i < 8; i++) {
        await db.connectorExecutionV2.create({
          data: {
            configId: payswapConfigId,
            kind: i % 3 === 0 ? "WEBHOOK" : i % 3 === 1 ? "POLL" : "SYNC",
            status: i === 4 ? "FAILED" : "SUCCESS",
            durationMs: Math.floor(Math.random() * 800) + 50,
            attempts: i === 4 ? 3 : 1,
            request: "{}", response: "{}",
            errorMessage: i === 4 ? "Connection timeout" : null,
            correlationId: `corr_${i}`,
            completedAt: new Date(Date.now() - i * 1800000),
          },
        });
      }
    }
  }

  // 5. Health reports.
  for (const code of Object.keys(configs)) {
    const configId = configs[code];
    const existingHealth = await db.connectorHealth.count({ where: { configId } });
    if (existingHealth === 0) {
      await db.connectorHealth.create({
        data: {
          configId,
          status: code === "twilio-sms" ? "DEGRADED" : "HEALTHY",
          latencyMs: Math.floor(Math.random() * 500) + 50,
          errorRate: code === "twilio-sms" ? 0.08 : 0.01,
          retryRate: 0.02,
          throughput: Math.floor(Math.random() * 100) + 10,
          syncLagSec: Math.floor(Math.random() * 60),
          availability: code === "twilio-sms" ? 0.92 : 0.99,
        },
      });
    }
  }

  // 6. Schedules.
  for (const code of Object.keys(configs)) {
    const configId = configs[code];
    const existingSched = await db.connectorSchedule.count({ where: { configId } });
    if (existingSched === 0) {
      await db.connectorSchedule.create({
        data: { configId, type: "INTERVAL", expression: code === "payswap" ? "60" : "300", active: true, nextTriggerAt: new Date(Date.now() + 60000) },
      });
    }
  }

  // 7. Sync jobs + checkpoints.
  if (payswapConfigId) {
    const existingSync = await db.synchronizationJob.count({ where: { configId: payswapConfigId } });
    if (existingSync === 0) {
      const job = await db.synchronizationJob.create({
        data: {
          configId: payswapConfigId,
          organizationId: org.id,
          mode: "INCREMENTAL",
          status: "COMPLETED",
          recordsProcessed: 145,
          recordsCreated: 12,
          recordsUpdated: 130,
          recordsDeleted: 3,
          recordsFailed: 0,
          conflicts: 0,
          startedAt: new Date(Date.now() - 7200000),
          completedAt: new Date(Date.now() - 7180000),
          durationMs: 20000,
        },
      });
      await db.synchronizationCheckpoint.create({
        data: { syncJobId: job.id, resource: "payments", cursor: "pay_cursor_123", recordsSynced: 145, lastRecordAt: new Date() },
      });
    }
  }

  // 8. Webhook endpoints + deliveries.
  if (payswapConfigId) {
    const existingEndpoint = await db.webhookEndpoint.findFirst({ where: { configId: payswapConfigId } });
    let endpointId: string;
    if (!existingEndpoint) {
      const ep = await db.webhookEndpoint.create({
        data: { configId: payswapConfigId, organizationId: org.id, url: "https://api.eks-food.com/webhooks/payswap", eventTypes: JSON.stringify(["payment.succeeded", "payment.failed"]), signingSecret: "whsec_seed_secret", active: true, verified: true },
      });
      endpointId = ep.id;
    } else {
      endpointId = existingEndpoint.id;
    }
    const existingDeliveries = await db.webhookDelivery.count({ where: { endpointId } });
    if (existingDeliveries === 0) {
      for (let i = 0; i < 5; i++) {
        await db.webhookDelivery.create({
          data: {
            endpointId,
            eventId: `evt_seed_${i}`,
            eventType: i === 2 ? "payment.failed" : "payment.succeeded",
            payload: JSON.stringify({ id: `pay_${i}`, amount: 80 }),
            signature: `sig_${i}`,
            status: i === 2 ? "DEAD_LETTERED" : "DELIVERED",
            responseStatus: i === 2 ? 500 : 200,
            attempts: i === 2 ? 3 : 1,
            deliveredAt: new Date(Date.now() - i * 3600000),
          },
        });
      }
    }
  }

  // 9. Polling jobs.
  for (const code of Object.keys(configs)) {
    const configId = configs[code];
    const existingPoll = await db.pollingJob.count({ where: { configId } });
    if (existingPoll === 0) {
      await db.pollingJob.create({
        data: { configId, resource: code === "payswap" ? "payments" : "rows", intervalSec: code === "payswap" ? 60 : 300, adaptive: true, lastCursor: `cursor_${code}_123`, lastRecordCount: Math.floor(Math.random() * 50), status: "ACTIVE", lastPollAt: new Date(Date.now() - 120000) },
      });
    }
  }

  // 10. Schema definitions + versions + mappings.
  const bookingSchema = await db.schemaDefinition.upsert({
    where: { identifier: "booking.created" },
    update: {},
    create: { identifier: "booking.created", name: "Booking Created", description: "Event when a booking is created", format: "JSON" },
  });
  const existingVer = await db.schemaVersion.findFirst({ where: { schemaDefId: bookingSchema.id, version: "1.0.0" } });
  if (!existingVer) {
    const v1 = await db.schemaVersion.create({
      data: { schemaDefId: bookingSchema.id, version: "1.0.0", schema: JSON.stringify({ type: "object", required: ["code", "customerId"], properties: { code: { type: "string" }, customerId: { type: "string" } } }), compatibility: "BACKWARD", active: true },
    });
    await db.schemaDefinition.update({ where: { id: bookingSchema.id }, data: { latestVersionId: v1.id } });
  }

  // 11. Retry + rate-limit policies.
  const existingRetry = await db.retryPolicy.findFirst({ where: { name: "Default Retry" } });
  if (!existingRetry) {
    await db.retryPolicy.create({ data: { name: "Default Retry", maxAttempts: 3, baseDelayMs: 100, multiplier: 2, maxDelayMs: 5000, jitter: "FULL", budget: 100, budgetWindowMs: 60000, circuitBreaker: true, cbThreshold: 5, cbCooldownMs: 30000, active: true } });
  }
  const existingRl = await db.rateLimitPolicy.findFirst({ where: { name: "Default Rate Limit" } });
  if (!existingRl) {
    await db.rateLimitPolicy.create({ data: { name: "Default Rate Limit", capacity: 100, refillRate: 10, burstLimit: 20, concurrencyLimit: 10, adaptive: false, active: true } });
  }

  return {
    connectorVersions: await db.connectorVersion.count(),
    credentials: await db.connectorCredential.count(),
    configurations: await db.connectorConfigurationV2.count(),
    executions: await db.connectorExecutionV2.count(),
    healthReports: await db.connectorHealth.count(),
    schedules: await db.connectorSchedule.count(),
    syncJobs: await db.synchronizationJob.count(),
    webhookEndpoints: await db.webhookEndpoint.count(),
    webhookDeliveries: await db.webhookDelivery.count(),
    pollingJobs: await db.pollingJob.count(),
    schemas: await db.schemaDefinition.count(),
    retryPolicies: await db.retryPolicy.count(),
    rateLimitPolicies: await db.rateLimitPolicy.count(),
  };
}
