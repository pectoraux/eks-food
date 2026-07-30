export interface SendInput {
  readonly to: string; // email, phone, device token, or userId (in-app)
  readonly templateCode: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly organizationId?: string;
  readonly userId?: string;
}

export interface SendResult {
  readonly providerMessageId: string;
  readonly status: "SENT" | "FAILED";
  readonly detail?: string;
}

export interface EmailProvider { readonly name: string; send(input: SendInput): Promise<SendResult>; }
export interface SmsProvider { readonly name: string; send(input: SendInput): Promise<SendResult>; }
export interface PushProvider { readonly name: string; send(input: SendInput): Promise<SendResult>; }
export interface InAppProvider { readonly name: string; send(input: SendInput): Promise<SendResult>; }

export interface NotificationProvider {
  readonly email: EmailProvider;
  readonly sms: SmsProvider;
  readonly push: PushProvider;
  readonly inApp: InAppProvider;
}
