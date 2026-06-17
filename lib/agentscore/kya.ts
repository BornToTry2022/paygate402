/**
 * Pure KYA (Know-Your-Agent) scoring. Given a 0–100 reputation score and two
 * 0–1 activity signals, produce a weighted 0–100 trust score + its breakdown.
 * No I/O — the indexer (index.ts) gathers the inputs.
 */

export const KYA_WEIGHTS = { reputation: 0.5, jobCompletion: 0.25, paymentReliability: 0.25 } as const;

/** Minimal shapes so this pure core never imports the full @/ store modules. */
export type JobLike = { providerAgentId: string | null; status: number };
export type PaymentLike = { agentId: string | null };

/** Fraction (0–1) of the agent's PROVIDER jobs that reached Completed (status === 3). 0 if none. */
export function jobCompletionRate(jobs: JobLike[], agentId: string): number {
  const mine = jobs.filter((j) => j.providerAgentId === agentId);
  if (mine.length === 0) return 0;
  const completed = mine.filter((j) => j.status === 3).length;
  return completed / mine.length;
}

/** Activity-based reliability (0–1): successful payments by the agent, saturating at `target`. */
export function paymentReliability(payments: PaymentLike[], agentId: string, target = 10): number {
  const n = payments.filter((p) => p.agentId === agentId).length;
  return Math.min(1, n / target);
}

export interface KyaBreakdown {
  reputation: number;
  jobCompletion: number;
  paymentReliability: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Weighted 0–100 KYA from a 0–100 reputation score and two 0–1 signals. */
export function computeKya(input: {
  reputationScore: number;
  jobCompletionRate: number;
  paymentReliability: number;
}): { kya: number; breakdown: KyaBreakdown } {
  const breakdown: KyaBreakdown = {
    reputation: clamp01(input.reputationScore / 100),
    jobCompletion: clamp01(input.jobCompletionRate),
    paymentReliability: clamp01(input.paymentReliability),
  };
  const kya = Math.round(
    (KYA_WEIGHTS.reputation * breakdown.reputation +
      KYA_WEIGHTS.jobCompletion * breakdown.jobCompletion +
      KYA_WEIGHTS.paymentReliability * breakdown.paymentReliability) *
      100,
  );
  return { kya, breakdown };
}
