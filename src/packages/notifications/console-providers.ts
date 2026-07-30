/** Reference providers that log to console — swap for real providers in production. */
import type { EmailProvider, SmsProvider, PushProvider, InAppProvider, SendInput, SendResult } from "./types";
import { db } from "@/lib/db";

function ok(id: string): SendResult { return { providerMessageId: id, status: "SENT" }; }

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console-email";
  async send(input: SendInput): Promise<SendResult> {
    
    console.log(`[email→${input.to}] ${input.templateCode}`, input.variables);
    return ok(`email_${Date.now()}`);
  }
}
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console-sms";
  async send(input: SendInput): Promise<SendResult> {
    console.log(`[sms→${input.to}] ${input.templateCode}`, input.variables);
    return ok(`sms_${Date.now()}`);
  }
}
export class ConsolePushProvider implements PushProvider {
  readonly name = "console-push";
  async send(input: SendInput): Promise<SendResult> {
    console.log(`[push→${input.to}] ${input.templateCode}`, input.variables);
    return ok(`push_${Date.now()}`);
  }
}

/** In-app provider persists to the NotificationLog table (the user's notification center). */
export class InAppProviderImpl implements InAppProvider {
  readonly name = "in-app-db";
  async send(input: SendInput): Promise<SendResult> {
    const log = await db.notificationLog.create({
      data: {
        userId: input.userId ?? null,
        organizationId: input.organizationId ?? null,
        channel: "IN_APP",
        templateCode: input.templateCode,
        status: "SENT",
        payload: JSON.stringify({ to: input.to, variables: input.variables }),
        sentAt: new Date(),
      },
    });
    return ok(log.id);
  }
}
