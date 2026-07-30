/** Integration event types emitted by the payments context. */
export const PAYMENT_EVENTS = {
  PAYMENT_INTENT_CREATED: "Payment.IntentCreated",
  PAYMENT_SUCCEEDED: "Payment.Succeeded",
  PAYMENT_FAILED: "Payment.Failed",
  REFUND_REQUESTED: "Payment.RefundRequested",
  REFUNDED: "Payment.Refunded",
  TRANSFER_REQUESTED: "Payment.TransferRequested",
  TRANSFER_PAID: "Payment.TransferPaid",
  TRANSFER_FAILED: "Payment.TransferFailed",
} as const;

export type PaymentEvent = (typeof PAYMENT_EVENTS)[keyof typeof PAYMENT_EVENTS];
