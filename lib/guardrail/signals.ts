export type PaymentRow = {
  payer: string | null;
  agentId: string | null;
  amountUsdc: string;
  ts: string;
};

/** Identity a GuardRail policy is scoped to: the verified agent id if present, else the payer address. */
export function paymentKey(e: { payer: string | null; agentId: string | null }): string {
  if (e.agentId) return `agent:${e.agentId}`;
  return `addr:${(e.payer ?? "unknown").toLowerCase()}`;
}

function sameUtcDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

export function sumTodaysSpendUsd(events: PaymentRow[], key: string, now: Date): number {
  let total = 0;
  for (const e of events) {
    if (paymentKey(e) !== key) continue;
    if (!sameUtcDay(new Date(e.ts), now)) continue;
    total += parseFloat(e.amountUsdc || "0");
  }
  return total;
}

export function countRecent(events: PaymentRow[], key: string, windowMs: number, now: Date): number {
  const cutoff = now.getTime() - windowMs;
  let n = 0;
  for (const e of events) {
    if (paymentKey(e) !== key) continue;
    if (new Date(e.ts).getTime() >= cutoff) n++;
  }
  return n;
}
