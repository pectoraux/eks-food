/**
 * Money utilities. Eks-Food never stores fractional currency as floats; all
 * monetary amounts are represented as integer minor units internally and as
 * decimal `Money` value objects at boundaries. Currency is ISO-4217.
 */
import type { Brand } from "./ids";

export type CurrencyCode = Brand<string, "CurrencyCode">;

export interface Money {
  /** Amount in MAJOR units (e.g. 80.50 GHS). Use integer minor units for storage. */
  readonly amount: number;
  readonly currency: CurrencyCode;
}

export const CURRENCIES = ["GHS", "USD", "EUR", "GBP", "NGN", "KES", "ZAR"] as const;
export type SupportedCurrency = (typeof CURRENCIES)[number];

const DECIMALS: Record<string, number> = {
  GHS: 2, USD: 2, EUR: 2, GBP: 2, NGN: 2, KES: 2, ZAR: 2,
};

export function currency(code: string): CurrencyCode {
  return code.toUpperCase() as CurrencyCode;
}

export function money(amount: number, currencyCode: string): Money {
  if (!Number.isFinite(amount)) throw new RangeError("Money amount must be finite");
  if (amount < 0) throw new RangeError("Money amount must be non-negative");
  return { amount: round2(amount), currency: currency(currencyCode) };
}

/** Convert major-units Money to integer minor units (for storage / external APIs). */
export function toMinorUnits(m: Money): number {
  const decimals = DECIMALS[m.currency] ?? 2;
  return Math.round(m.amount * 10 ** decimals);
}

/** Convert integer minor units back to a Money value object. */
export function fromMinorUnits(minor: number, currencyCode: string): Money {
  const decimals = DECIMALS[currencyCode] ?? 2;
  return { amount: round2(minor / 10 ** decimals), currency: currency(currencyCode) };
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: round2(a.amount + b.amount), currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: round2(a.amount - b.amount), currency: a.currency };
}

export function multiplyMoney(a: Money, factor: number): Money {
  if (factor < 0) throw new RangeError("Money multiplier must be non-negative");
  return { amount: round2(a.amount * factor), currency: a.currency };
}

/** Allocate money into `parts` proportions, distributing the rounding remainder. */
export function allocateMoney(m: Money, proportions: number[]): Money[] {
  if (proportions.length === 0) return [];
  const total = proportions.reduce((s, p) => s + p, 0);
  if (total <= 0) throw new RangeError("Proportions must sum to a positive number");
  const minor = toMinorUnits(m);
  const raw = proportions.map((p) => (minor * p) / total);
  const floor = raw.map((r) => Math.floor(r));
  const allocated = floor.reduce((s, n) => s + n, 0);
  const remainder = minor - allocated;
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) floor[order[k % order.length].i] += 1;
  return floor.map((n) => fromMinorUnits(n, m.currency));
}

export function formatMoney(m: Money, opts?: { precise?: boolean }): string {
  const symbol = SYMBOLS[m.currency] ?? "";
  const frac = opts?.precise ? 2 : 0;
  return `${symbol}${m.amount.toLocaleString(undefined, {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  })}`;
}

const SYMBOLS: Record<string, string> = {
  GHS: "₵", USD: "$", EUR: "€", GBP: "£", NGN: "₦", KES: "KSh", ZAR: "R",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}
