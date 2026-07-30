/**
 * Webhook platform — registration, verification, retries, signatures, DLQ.
 *
 * Inbound: external systems POST to our webhook endpoints. We verify the
 * signature, dedupe by eventId (idempotency), and deliver to the event bus.
 * Outbound: we deliver platform events to registered endpoints with retries.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { uuid } from "@eks/common";

export interface WebhookEndpoint {
  readonly id: string;
  readonly url: string;
  readonly eventTypes: readonly string[];
  readonly signingSecret: string;
  readonly active: boolean;
  readonly verified: boolean;
}

export interface WebhookDeliveryResult {
  readonly delivered: boolean;
  readonly status: number;
  readonly attempts: number;
  readonly errorMessage?: string;
}

/** Compute the HMAC-SHA256 signature for a webhook payload. */
export function signWebhook(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Verify a webhook signature (constant-time comparison). */
export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = signWebhook(payload, secret);
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export class WebhookPlatform {
  /** Register a new outbound webhook endpoint. */
  async registerEndpoint(input: { configId: string; organizationId: string; url: string; eventTypes: string[]; signingSecret: string }): Promise<WebhookEndpoint> {
    const endpoint = await db.webhookEndpoint.create({
      data: {
        configId: input.configId,
        organizationId: input.organizationId,
        url: input.url,
        eventTypes: JSON.stringify(input.eventTypes),
        signingSecret: input.signingSecret,
        active: true,
        verified: true,
      },
    });
    return {
      id: endpoint.id,
      url: endpoint.url,
      eventTypes: JSON.parse(endpoint.eventTypes),
      signingSecret: endpoint.signingSecret,
      active: endpoint.active,
      verified: endpoint.verified,
    };
  }

  /** Receive an inbound webhook (from an external system). */
  async receive(input: { endpointId: string; payload: string; signature: string; eventType: string; eventId: string }): Promise<{ accepted: boolean; reason?: string }> {
    const endpoint = await db.webhookEndpoint.findUnique({ where: { id: input.endpointId } });
    if (!endpoint) return { accepted: false, reason: "ENDPOINT_NOT_FOUND" };
    if (!endpoint.active) return { accepted: false, reason: "ENDPOINT_INACTIVE" };

    // Verify the signature.
    if (!verifyWebhookSignature(input.payload, input.signature, endpoint.signingSecret)) {
      return { accepted: false, reason: "INVALID_SIGNATURE" };
    }

    // Idempotency: check if we've already processed this eventId.
    const existing = await db.webhookDelivery.findFirst({ where: { eventId: input.eventId, endpointId: input.endpointId } });
    if (existing) return { accepted: true, reason: "DUPLICATE" };

    // Record the delivery.
    await db.webhookDelivery.create({
      data: {
        endpointId: input.endpointId,
        eventId: input.eventId,
        eventType: input.eventType,
        payload: input.payload,
        signature: input.signature,
        status: "DELIVERED",
        deliveredAt: new Date(),
        attempts: 1,
      },
    });

    return { accepted: true };
  }

  /** Deliver an outbound webhook (to a registered endpoint). */
  async deliver(input: { endpointId: string; eventId: string; eventType: string; payload: Record<string, unknown> }): Promise<WebhookDeliveryResult> {
    const endpoint = await db.webhookEndpoint.findUnique({ where: { id: input.endpointId } });
    if (!endpoint || !endpoint.active) return { delivered: false, status: 0, attempts: 0, errorMessage: "ENDPOINT_INACTIVE" };

    // Filter: only deliver if the endpoint subscribes to this event type (or subscribes to all).
    const eventTypes = JSON.parse(endpoint.eventTypes) as string[];
    if (eventTypes.length > 0 && !eventTypes.includes(input.eventType)) {
      return { delivered: false, status: 0, attempts: 0, errorMessage: "EVENT_TYPE_NOT_SUBSCRIBED" };
    }

    const payloadStr = JSON.stringify(input.payload);
    const signature = signWebhook(payloadStr, endpoint.signingSecret);

    // Record the delivery attempt.
    const delivery = await db.webhookDelivery.create({
      data: {
        endpointId: input.endpointId,
        eventId: input.eventId,
        eventType: input.eventType,
        payload: payloadStr,
        signature,
        status: "PENDING",
        firstAttemptAt: new Date(),
      },
    });

    // Attempt delivery (with retries).
    let attempts = 0;
    let lastError: string | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      attempts = attempt;
      try {
        const res = await fetch(endpoint.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Webhook-Signature": signature, "X-Webhook-EventId": input.eventId },
          body: payloadStr,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          await db.webhookDelivery.update({
            where: { id: delivery.id },
            data: { status: "DELIVERED", responseStatus: res.status, attempts, deliveredAt: new Date(), lastAttemptAt: new Date() },
          });
          return { delivered: true, status: res.status, attempts };
        }
        lastError = `HTTP ${res.status}`;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
      await new Promise((r) => setTimeout(r, 200 * 2 ** (attempt - 1)));
    }

    // Dead-letter after max attempts.
    await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "DEAD_LETTERED", attempts, errorMessage: lastError, lastAttemptAt: new Date() },
    });
    return { delivered: false, status: 0, attempts, errorMessage: lastError };
  }

  /** List deliveries for an endpoint (webhook explorer). */
  async listDeliveries(endpointId: string, limit = 50): Promise<readonly unknown[]> {
    return db.webhookDelivery.findMany({ where: { endpointId }, orderBy: { firstAttemptAt: "desc" }, take: limit });
  }
}

export { uuid };
