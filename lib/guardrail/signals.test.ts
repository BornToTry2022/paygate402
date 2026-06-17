import { describe, it, expect } from "vitest";
import { paymentKey, sumTodaysSpendUsd, countRecent, type PaymentRow } from "./signals";

const NOW = new Date("2026-06-17T12:00:00.000Z");
function row(over: Partial<PaymentRow>): PaymentRow {
  return { payer: "0xPAYER", agentId: "668408", amountUsdc: "0.003", ts: NOW.toISOString(), ...over };
}

describe("paymentKey", () => {
  it("prefers agentId", () => {
    expect(paymentKey({ payer: "0xAbC", agentId: "42" })).toBe("agent:42");
  });
  it("falls back to lowercased payer when no agentId", () => {
    expect(paymentKey({ payer: "0xAbC", agentId: null })).toBe("addr:0xabc");
  });
});

describe("sumTodaysSpendUsd", () => {
  it("sums only this key's payments dated today (UTC)", () => {
    const events: PaymentRow[] = [
      row({ amountUsdc: "0.003" }),
      row({ amountUsdc: "0.005" }),
      row({ agentId: "999", amountUsdc: "1.00" }), // different key
      row({ amountUsdc: "0.01", ts: "2026-06-16T23:59:59.000Z" }), // yesterday UTC
    ];
    expect(sumTodaysSpendUsd(events, "agent:668408", NOW)).toBeCloseTo(0.008, 6);
  });
});

describe("countRecent", () => {
  it("counts only this key's payments within windowMs of now", () => {
    const events: PaymentRow[] = [
      row({ ts: new Date(NOW.getTime() - 1_000).toISOString() }),
      row({ ts: new Date(NOW.getTime() - 5_000).toISOString() }),
      row({ ts: new Date(NOW.getTime() - 20_000).toISOString() }), // outside 10s window
      row({ agentId: "999", ts: NOW.toISOString() }), // different key
    ];
    expect(countRecent(events, "agent:668408", 10_000, NOW)).toBe(2);
  });
});
