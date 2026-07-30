/**
 * NotificationService — template registry + provider dispatch.
 * Templates render variables into a subject + body per channel.
 */
import { db } from "@/lib/db";
import type { EmailProvider, SmsProvider, PushProvider, InAppProvider, SendInput, SendResult } from "./types";
import { ConsoleEmailProvider, ConsoleSmsProvider, ConsolePushProvider, InAppProviderImpl } from "./console-providers";

export type TemplateCode =
  | "WELCOME" | "PASSWORD_CHANGED" | "PASSWORD_RESET" | "MAGIC_LINK"
  | "MFA_ENABLED" | "MFA_DISABLED" | "RECOVERY_CODES" | "LOGIN_NEW_DEVICE"
  | "INVITATION" | "INVITATION_ACCEPTED" | "ROLE_ASSIGNED" | "ORG_SUSPENDED"
  | "SESSION_REVOKED" | "VERIFICATION_REQUESTED" | "VERIFICATION_COMPLETED";

interface TemplateDef {
  readonly code: TemplateCode;
  readonly channel: "EMAIL" | "SMS" | "PUSH" | "IN_APP";
  readonly subject: string;
  readonly body: string;
}

export const NOTIFICATION_TEMPLATES: ReadonlyArray<TemplateDef> = [
  { code: "WELCOME", channel: "EMAIL", subject: "Welcome to Eks-Food, {{name}}!", body: "Your account is ready. Start booking trusted cooks today." },
  { code: "PASSWORD_CHANGED", channel: "EMAIL", subject: "Your Eks-Food password was changed", body: "If this wasn't you, reset your password immediately." },
  { code: "PASSWORD_RESET", channel: "EMAIL", subject: "Reset your Eks-Food password", body: "Use this link to reset your password: {{link}}" },
  { code: "MAGIC_LINK", channel: "EMAIL", subject: "Your Eks-Food sign-in link", body: "Click to sign in: {{link}}" },
  { code: "MFA_ENABLED", channel: "EMAIL", subject: "MFA enabled on your account", body: "Two-factor authentication is now active." },
  { code: "RECOVERY_CODES", channel: "EMAIL", subject: "Your Eks-Food recovery codes", body: "Store these safely: {{codes}}" },
  { code: "LOGIN_NEW_DEVICE", channel: "EMAIL", subject: "New sign-in to your Eks-Food account", body: "From {{device}} at {{ip}}. If this wasn't you, revoke the session." },
  { code: "INVITATION", channel: "EMAIL", subject: "You're invited to {{orgName}} on Eks-Food", body: "Accept your invitation: {{link}}" },
  { code: "ROLE_ASSIGNED", channel: "IN_APP", subject: "New role: {{roleName}}", body: "You've been assigned the {{roleName}} role in {{orgName}}." },
  { code: "ORG_SUSPENDED", channel: "IN_APP", subject: "Organization suspended", body: "{{orgName}} has been suspended. Contact support." },
  { code: "SESSION_REVOKED", channel: "IN_APP", subject: "Session revoked", body: "A session was revoked on your account." },
];

export class NotificationService {
  private readonly email: EmailProvider;
  private readonly sms: SmsProvider;
  private readonly push: PushProvider;
  private readonly inApp: InAppProvider;

  constructor(email?: EmailProvider, sms?: SmsProvider, push?: PushProvider, inApp?: InAppProvider) {
    this.email = email ?? new ConsoleEmailProvider();
    this.sms = sms ?? new ConsoleSmsProvider();
    this.push = push ?? new ConsolePushProvider();
    this.inApp = inApp ?? new InAppProviderImpl();
  }

  async send(input: SendInput): Promise<SendResult> {
    const template = NOTIFICATION_TEMPLATES.find((t) => t.code === input.templateCode);
    if (!template) throw new Error(`Unknown notification template: ${input.templateCode}`);
    const rendered: SendInput = { ...input, variables: { ...input.variables, subject: render(template.subject, input.variables), body: render(template.body, input.variables) } };
    const provider = template.channel === "EMAIL" ? this.email : template.channel === "SMS" ? this.sms : template.channel === "PUSH" ? this.push : this.inApp;
    const result = await provider.send(rendered);
    // Persist to NotificationLog for all channels (audit + in-app center).
    await db.notificationLog.create({
      data: {
        userId: input.userId ?? null,
        organizationId: input.organizationId ?? null,
        channel: template.channel,
        templateCode: input.templateCode,
        status: result.status,
        payload: JSON.stringify({ to: input.to, variables: input.variables, providerMessageId: result.providerMessageId }),
        sentAt: result.status === "SENT" ? new Date() : null,
      },
    }).catch(() => null);
    return result;
  }
}

function render(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}
