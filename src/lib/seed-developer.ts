import { db } from "@/lib/db";

/**
 * Idempotent seed for the Developer Platform: publishers, extensions,
 * versions, manifests, installations, connectors, workflows, secrets,
 * runtime health, and logs.
 */
export async function seedDeveloper(force = false) {
  if (force) {
    await db.extensionLog.deleteMany();
    await db.runtimeHealth.deleteMany();
    await db.secret.deleteMany();
    await db.eventReplay.deleteMany();
    await db.workflowExecution.deleteMany();
    await db.workflowDefinition.deleteMany();
    await db.connectorExecution.deleteMany();
    await db.connectorConfiguration.deleteMany();
    await db.connectorDefinition.deleteMany();
    await db.extensionManifest.deleteMany();
    await db.package.deleteMany();
    await db.extensionInstallation.deleteMany();
    await db.extensionVersion.deleteMany();
    await db.extension.deleteMany();
    await db.publisher.deleteMany();
  }

  // 1. Publisher.
  const publisher = await db.publisher.upsert({
    where: { handle: "eks-food" },
    update: {},
    create: {
      handle: "eks-food",
      name: "Eks-Food Official",
      description: "First-party Eks-Food extensions",
      verificationStatus: "VERIFIED",
      publicKey: "ed25519:base64placeholder",
      contactEmail: "devrel@eks-food.com",
      ownerUserId: "system",
    },
  });

  const publisher2 = await db.publisher.upsert({
    where: { handle: "acme-corp" },
    update: {},
    create: {
      handle: "acme-corp",
      name: "Acme Corp",
      description: "Third-party connector publisher",
      verificationStatus: "PENDING",
      contactEmail: "dev@acme.com",
      ownerUserId: "system",
    },
  });

  // 2. Extensions + versions + manifests.
  const extensions = [
    {
      identifier: "com.eksfood.cook-analytics",
      name: "Cook Analytics",
      description: "Analytics dashboard for cook performance",
      publisherId: publisher.id,
      category: "analytics",
      tags: "analytics|cooks|dashboard",
      version: "1.2.0",
      capabilities: [{ name: "api.handler" }, { name: "event.subscriber" }],
      permissions: [{ code: "read.cooks", description: "Read cook data" }, { code: "read.analytics", description: "Read analytics" }],
      compatRange: ">=1.0.0 <2.0.0",
    },
    {
      identifier: "com.eksfood.sms-notifier",
      name: "SMS Notifier",
      description: "Send SMS notifications for booking events",
      publisherId: publisher.id,
      category: "notifications",
      tags: "sms|notifications",
      version: "2.0.1",
      capabilities: [{ name: "event.subscriber" }, { name: "background.worker" }],
      permissions: [{ code: "subscribe.events", description: "Subscribe to events" }, { code: "read.bookings", description: "Read bookings" }],
      compatRange: ">=1.0.0",
    },
    {
      identifier: "com.acme.google-sheets-sync",
      name: "Google Sheets Sync",
      description: "Sync booking data to Google Sheets",
      publisherId: publisher2.id,
      category: "integrations",
      tags: "google|sheets|sync",
      version: "0.3.0",
      capabilities: [{ name: "connector" }, { name: "background.worker" }],
      permissions: [{ code: "read.bookings", description: "Read bookings" }, { code: "access.procurement", description: "Access procurement" }],
      compatRange: ">=1.0.0 <2.0.0",
    },
    {
      identifier: "com.eksfood.food-safety-compliance",
      name: "Food Safety Compliance",
      description: "Automated food safety inspection scheduler",
      publisherId: publisher.id,
      category: "compliance",
      tags: "safety|inspections|compliance",
      version: "1.0.0",
      capabilities: [{ name: "scheduled.job" }, { name: "api.handler" }],
      permissions: [{ code: "invoke.apis", description: "Invoke platform APIs" }, { code: "read.analytics", description: "Read analytics" }],
      compatRange: ">=1.0.0",
    },
  ];

  for (const ext of extensions) {
    const extension = await db.extension.upsert({
      where: { identifier: ext.identifier },
      update: {},
      create: {
        identifier: ext.identifier,
        name: ext.name,
        description: ext.description,
        publisherId: ext.publisherId,
        category: ext.category,
        tags: ext.tags,
        status: "ACTIVE",
        visibility: "PRIVATE",
      },
    });

    const manifest = {
      metadata: { id: ext.identifier, name: ext.name, version: ext.version, description: ext.description, publisher: ext.publisherId === publisher.id ? "eks-food" : "acme-corp" },
      capabilities: ext.capabilities,
      permissions: ext.permissions,
      requiredAPIs: [],
      requiredEvents: ext.identifier.includes("sms") ? ["Booking.Confirmed", "Booking.Cancelled"] : [],
      configurationSchema: {},
      connectorDependencies: ext.identifier.includes("sheets") ? ["google-sheets"] : [],
      localization: { defaultLanguage: "en", supportedLanguages: ["en", "tw", "ha"] },
      licensing: { type: ext.publisherId === publisher.id ? "internal" : "free" },
      compatibility: { platformRange: ext.compatRange },
    };

    const version = await db.extensionVersion.create({
      data: {
        extensionId: extension.id,
        version: ext.version,
        manifest: JSON.stringify(manifest),
        checksum: `sha256:${ext.identifier.replace(/[^a-z0-9]/g, "")}${Date.now().toString(36)}`,
        signature: `ed25519:${ext.identifier.slice(0, 8)}`,
        sizeBytes: Math.floor(Math.random() * 50000) + 10000,
        status: "RELEASED",
        rolloutPercent: 100,
        changelog: `Release ${ext.version}`,
        compatRange: ext.compatRange,
        publishedAt: new Date(),
      },
    });

    await db.extensionManifest.create({
      data: {
        versionId: version.id,
        name: ext.name,
        version: ext.version,
        capabilities: JSON.stringify(ext.capabilities),
        permissions: JSON.stringify(ext.permissions),
        requiredAPIs: "[]",
        requiredEvents: JSON.stringify(manifest.requiredEvents),
        configSchema: "{}",
        connectorDeps: JSON.stringify(manifest.connectorDependencies),
        localization: JSON.stringify(manifest.localization),
        licensing: JSON.stringify(manifest.licensing),
        compatRange: ext.compatRange,
        validationStatus: "VALID",
      },
    });

    await db.package.create({
      data: {
        versionId: version.id,
        publisherId: ext.publisherId,
        artifactUrl: `packages/${ext.identifier}/${ext.version}.tar.zst`,
        checksum: version.checksum,
        signature: version.signature,
        sizeBytes: version.sizeBytes,
        format: "tar+zstd",
        signatureVerified: ext.publisherId === publisher.id,
        malwareScanPassed: true,
        status: "PUBLISHED",
      },
    });

    await db.extension.update({ where: { id: extension.id }, data: { latestVersionId: version.id } });
  }

  // 3. Connector definitions.
  const connectors = [
    { code: "payswap", name: "Payswap", description: "Payment processing connector", supportsWebhooks: true, supportsPolling: true, defaultSyncIntervalSec: 60 },
    { code: "google-sheets", name: "Google Sheets", description: "Sync data to Google Sheets", supportsWebhooks: false, supportsPolling: true, defaultSyncIntervalSec: 300 },
    { code: "twilio-sms", name: "Twilio SMS", description: "Send SMS via Twilio", supportsWebhooks: true, supportsPolling: false, defaultSyncIntervalSec: 0 },
    { code: "ghana-post", name: "Ghana Post", description: "Address verification via Ghana Post", supportsWebhooks: false, supportsPolling: true, defaultSyncIntervalSec: 600 },
  ];
  for (const c of connectors) {
    const existing = await db.connectorDefinition.findUnique({ where: { code: c.code } });
    if (!existing) {
      await db.connectorDefinition.create({ data: { ...c, authSchema: "{}", active: true } });
    }
  }

  // 4. Connector executions (sample history).
  const payswapConfig = await db.connectorConfiguration.findFirst({ where: { connectorDef: { code: "payswap" } } });
  if (!payswapConfig) {
    const payswapDef = await db.connectorDefinition.findUnique({ where: { code: "payswap" } });
    const org = await db.organization.findFirst();
    if (payswapDef && org) {
      const config = await db.connectorConfiguration.create({
        data: {
          connectorDefId: payswapDef.id,
          organizationId: org.id,
          name: "Payswap Production",
          encryptedConfig: JSON.stringify({ apiKey: "encrypted:psw_live_xxx" }),
          status: "ACTIVE",
          lastSyncAt: new Date(),
        },
      });
      // Sample executions.
      for (let i = 0; i < 5; i++) {
        await db.connectorExecution.create({
          data: {
            configId: config.id,
            kind: i % 2 === 0 ? "WEBHOOK" : "POLL",
            status: "SUCCESS",
            durationMs: Math.floor(Math.random() * 500) + 50,
            attempts: 1,
            request: "{}",
            response: "{}",
            completedAt: new Date(Date.now() - i * 3600000),
          },
        });
      }
      // One failed execution.
      await db.connectorExecution.create({
        data: {
          configId: config.id,
          kind: "SYNC",
          status: "FAILED",
          durationMs: 5000,
          attempts: 3,
          request: "{}",
          response: "{}",
          errorMessage: "Connection timeout after 3 retries",
          completedAt: new Date(Date.now() - 1800000),
        },
      });
    }
  }

  // 5. Workflow definitions + executions.
  const org = await db.organization.findFirst();
  if (org) {
    const wfDef = await db.workflowDefinition.findFirst({ where: { organizationId: org.id, name: "Booking Confirmation Flow" } });
    if (!wfDef) {
      const def = await db.workflowDefinition.create({
        data: {
          organizationId: org.id,
          name: "Booking Confirmation Flow",
          description: "Confirm booking → notify customer → assign cook",
          definition: JSON.stringify({
            trigger: { type: "event", eventType: "Booking.Created" },
            steps: [
              { id: "validate", name: "Validate booking", action: { type: "transform", config: {} }, next: "notify" },
              { id: "notify", name: "Notify customer", action: { type: "event-publish", config: { event: "Notification.Send" } }, next: "assign" },
              { id: "assign", name: "Assign cook", action: { type: "api-call", config: { path: "/api/v1/bookings/assign" } } },
            ],
            initialStep: "validate",
          }),
          active: true,
        },
      });
      // Sample executions.
      for (let i = 0; i < 3; i++) {
        await db.workflowExecution.create({
          data: {
            workflowDefId: def.id,
            organizationId: org.id,
            status: "COMPLETED",
            trigger: JSON.stringify({ type: "event", eventType: "Booking.Created" }),
            state: "{}",
            stepsCompleted: JSON.stringify(["validate", "notify", "assign"]),
            stepsFailed: "[]",
            startedAt: new Date(Date.now() - i * 7200000),
            completedAt: new Date(Date.now() - i * 7200000 + 1500),
            durationMs: 1500,
          },
        });
      }
    }
  }

  // 6. Event replays (sample history).
  if (org) {
    const existingReplays = await db.eventReplay.count({ where: { organizationId: org.id } });
    if (existingReplays === 0) {
      await db.eventReplay.create({
        data: {
          organizationId: org.id,
          eventId: "evt_seed_1",
          eventType: "Booking.Confirmed",
          mode: "DRY_RUN",
          status: "COMPLETED",
          originalPayload: JSON.stringify({ bookingCode: "EKS-DEMO1" }),
          result: JSON.stringify({ replayed: true, handlers: 2 }),
          requestedById: "system",
          startedAt: new Date(Date.now() - 3600000),
          completedAt: new Date(Date.now() - 3595000),
        },
      });
    }
  }

  return {
    publishers: await db.publisher.count(),
    extensions: await db.extension.count(),
    versions: await db.extensionVersion.count(),
    packages: await db.package.count(),
    connectorDefs: await db.connectorDefinition.count(),
    connectorExecs: await db.connectorExecution.count(),
    workflows: await db.workflowDefinition.count(),
    workflowExecs: await db.workflowExecution.count(),
    eventReplays: await db.eventReplay.count(),
  };
}
