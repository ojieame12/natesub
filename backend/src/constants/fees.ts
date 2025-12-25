/**
 * Fee Constants - Single source of truth for all fee calculations
 *
 * Split Fee Model (v2):
 * - 4% paid by subscriber (added to price)
 * - 4% paid by creator (deducted from payout)
 * - 8% total platform fee
 *
 * Psychology: Neither party sees "8%" - both see 4% as reasonable.
 */

// Total platform fee rate: 8%
export const PLATFORM_FEE_RATE = 0.08

// Split rate: each party pays 4%
export const SPLIT_RATE = 0.04

// Cross-border buffer for FX/Stripe surcharge: 1.5%
export const CROSS_BORDER_BUFFER = 0.015

// Processor fee estimates by currency (for margin calculation)
// These are conservative estimates to ensure we never go negative
export const PROCESSOR_FEES: Record<string, { percentRate: number; fixedCents: number }> = {
  USD: { percentRate: 0.029, fixedCents: 30 },    // Stripe US: 2.9% + 30¢
  EUR: { percentRate: 0.029, fixedCents: 25 },    // Stripe EU: 2.9% + €0.25
  GBP: { percentRate: 0.029, fixedCents: 20 },    // Stripe UK: 2.9% + 20p
  CAD: { percentRate: 0.029, fixedCents: 30 },    // Stripe CA: 2.9% + 30¢
  AUD: { percentRate: 0.029, fixedCents: 30 },    // Stripe AU: 2.9% + 30¢
  ZAR: { percentRate: 0.029, fixedCents: 500 },   // ~R5.00 fixed
  KES: { percentRate: 0.015, fixedCents: 5000 },  // Paystack: 1.5% + KSh50
  NGN: { percentRate: 0.015, fixedCents: 10000 }, // Paystack: 1.5% + ₦100
  GHS: { percentRate: 0.019, fixedCents: 0 },     // Paystack Ghana: 1.9%
}

// Default processor fees for unknown currencies
export const DEFAULT_PROCESSOR_FEE = { percentRate: 0.029, fixedCents: 30 }

// Minimum margin we want to keep after processor fees (in smallest currency unit)
// This ensures we're profitable on every transaction
export const MIN_MARGIN_CENTS: Record<string, number> = {
  USD: 25,     // $0.25 minimum profit
  EUR: 25,     // €0.25
  GBP: 20,     // £0.20
  CAD: 35,     // $0.35
  AUD: 35,     // $0.35
  ZAR: 500,    // R5.00
  KES: 2500,   // KSh25.00
  NGN: 25000,  // ₦250.00 (25,000 kobo)
  GHS: 250,    // ₵2.50
}

// Default minimum margin for unknown currencies
export const DEFAULT_MIN_MARGIN = 25
