/**
 * @eks/notifications — provider-agnostic notification abstraction.
 *
 * Four channels (EMAIL, SMS, PUSH, IN_APP) each behind a provider interface.
 * The registry selects the configured provider. Identity events trigger
 * notifications via templates. No provider lock-in.
 */
export type { EmailProvider, SmsProvider, PushProvider, InAppProvider, NotificationProvider, SendInput, SendResult } from "./types";
export { NotificationService, NOTIFICATION_TEMPLATES, type TemplateCode } from "./service";
export { ConsoleEmailProvider, ConsoleSmsProvider, ConsolePushProvider, InAppProviderImpl } from "./console-providers";
