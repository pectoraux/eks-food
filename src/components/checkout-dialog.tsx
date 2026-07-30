"use client";

import { useState } from "react";
import { ShieldCheck, Loader2, CheckCircle2, Smartphone, CreditCard, Landmark, Wallet, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useCheckout, useConfirmPayment } from "@/lib/api";
import { formatCurrencyPrecise } from "@/lib/format";
import { toast } from "sonner";

type Method = "mobile_money" | "card" | "bank_transfer";

const METHODS: { id: Method; label: string; desc: string; icon: typeof Smartphone; providers: string[] }[] = [
  { id: "mobile_money", label: "Mobile Money", desc: "MTN, Vodafone, AirtelTigo", icon: Smartphone, providers: ["mtn", "vodafone", "airteltigo"] },
  { id: "card", label: "Card", desc: "Visa, Mastercard", icon: CreditCard, providers: ["visa", "mastercard"] },
  { id: "bank_transfer", label: "Bank Transfer", desc: "Direct bank transfer", icon: Landmark, providers: ["ecobank", "gcb"] },
];

/**
 * Payswap-hosted checkout simulation.
 * Mirrors the Stripe Checkout UX: the customer selects a method and authorises
 * on Payswap's domain. Eks-Food only receives the resulting payment intent
 * status — never the credentials.
 */
export function CheckoutDialog({
  open, onOpenChange, bookingCode, amount, currency, customerEmail,
  onPaid,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  bookingCode: string; amount: number; currency: string; customerEmail?: string;
  onPaid: (result: { bookingCode: string | null; amount: number; currency: string }) => void;
}) {
  const [method, setMethod] = useState<Method>("mobile_money");
  const [provider, setProvider] = useState("mtn");
  const [identifier, setIdentifier] = useState("");
  const [stage, setStage] = useState<"select" | "authorising" | "done">("select");

  const checkout = useCheckout();
  const confirm = useConfirmPayment();

  const handlePay = async () => {
    try {
      setStage("authorising");
      // 1. Create a Payswap Checkout Session
      const session = await checkout.mutateAsync({ bookingCode, customerEmail });
      // 2. Customer authorises on Payswap-hosted page (simulated here)
      await new Promise((r) => setTimeout(r, 1200));
      // 3. Payswap confirms the intent — Eks-Food records only the reference
      const result = await confirm.mutateAsync({ payswapId: session.paymentId, method, provider });
      setStage("done");
      toast.success("Payment successful", { description: `${formatCurrencyPrecise(result.amount, result.currency)} authorised via Payswap` });
      setTimeout(() => {
        onPaid({ bookingCode: result.bookingCode, amount: result.amount, currency: result.currency });
        onOpenChange(false);
        setStage("select");
        setIdentifier("");
      }, 1400);
    } catch (e) {
      setStage("select");
      toast.error("Payment failed", { description: e instanceof Error ? e.message : "Please try again" });
    }
  };

  const selectedMethod = METHODS.find((m) => m.id === method)!;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setStage("select"); setIdentifier(""); } }}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0 sm:max-h-[90vh] sm:flex sm:flex-col">
        {/* Payswap-style header */}
        <div className="brand-gradient shrink-0 px-6 py-5 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20">
                <Wallet className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-bold">Payswap</div>
                <div className="text-[10px] text-white/80">Secure checkout</div>
              </div>
            </div>
            <Badge className="border-white/20 bg-white/15 text-white">SSL</Badge>
          </div>
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wide text-white/70">You pay</div>
            <div className="text-3xl font-bold">{formatCurrencyPrecise(amount, currency)}</div>
            <div className="mt-0.5 text-xs text-white/80">Booking {bookingCode} · Eks-Food Ghana</div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 scrollbar-thin">
          {stage === "done" ? (
            <div className="flex flex-col items-center py-6 text-center">
              <CheckCircle2 className="h-14 w-14 text-emerald-500" />
              <h3 className="mt-3 text-base font-semibold">Payment successful</h3>
              <p className="mt-1 text-xs text-muted-foreground">Cook assigned & payout initiated via Payswap.</p>
            </div>
          ) : (
            <>
              <DialogHeader className="p-0">
                <DialogTitle className="text-base">Choose a payment method</DialogTitle>
                <DialogDescription className="text-xs">
                  You authorise on Payswap&rsquo;s secure page. Eks-Food never sees your credentials.
                </DialogDescription>
              </DialogHeader>

              <RadioGroup value={method} onValueChange={(v) => { setMethod(v as Method); setProvider(METHODS.find((m) => m.id === v)!.providers[0]); }} className="mt-4 space-y-2">
                {METHODS.map((m) => {
                  const Icon = m.icon;
                  const active = method === m.id;
                  return (
                    <Label key={m.id} htmlFor={m.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}>
                      <RadioGroupItem value={m.id} id={m.id} />
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{m.label}</div>
                        <div className="text-[11px] text-muted-foreground">{m.desc}</div>
                      </div>
                    </Label>
                  );
                })}
              </RadioGroup>

              {method !== "card" && (
                <div className="mt-3 space-y-2">
                  <Label className="text-xs">{method === "mobile_money" ? "Provider" : "Bank"}</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedMethod.providers.map((p) => (
                      <button key={p} type="button" onClick={() => setProvider(p)} className={`rounded-md border px-2.5 py-1 text-xs capitalize transition-colors ${provider === p ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                        {p}
                      </button>
                    ))}
                  </div>
                  <Input
                    placeholder={method === "mobile_money" ? "Mobile money number" : "Bank account reference"}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="mt-2"
                  />
                </div>
              )}

              <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted/60 p-2.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                <span>Payment is processed by Payswap. Eks-Food stores only the payment reference &amp; status — never card numbers, PINs, or bank credentials.</span>
              </div>
            </>
          )}
        </div>

        {stage !== "done" && (
          <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={stage === "authorising"}>Cancel</Button>
            <Button onClick={handlePay} disabled={stage === "authorising"} className="gap-2">
              {stage === "authorising" ? (<><Loader2 className="h-4 w-4 animate-spin" /> Authorising…</>) : (<>Pay {formatCurrencyPrecise(amount, currency)} <ArrowRight className="h-4 w-4" /></>)}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
