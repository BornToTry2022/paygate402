import { getReputation } from "@/lib/reputation";
import { listJobs } from "@/lib/jobs";
import { listPayments } from "@/lib/store";
import { computeKya, jobCompletionRate, paymentReliability, type JobLike, type PaymentLike, type KyaBreakdown } from "./kya";

export interface ScoreRow {
  agentId: string;
  kya: number;
  breakdown: KyaBreakdown;
  reputationScore: number;
  paymentCount: number;
  jobCount: number;
  completedJobs: number;
  rank: number;
}

const TTL_MS = 60_000;
let cache: { rows: ScoreRow[]; exp: number } | null = null;

async function computeRow(
  agentId: string,
  payments: PaymentLike[],
  jobs: JobLike[],
): Promise<Omit<ScoreRow, "rank">> {
  const rep = await getReputation(agentId);
  const { kya, breakdown } = computeKya({
    reputationScore: rep.score,
    jobCompletionRate: jobCompletionRate(jobs, agentId),
    paymentReliability: paymentReliability(payments, agentId),
  });
  const mine = jobs.filter((j) => j.providerAgentId === agentId);
  return {
    agentId,
    kya,
    breakdown,
    reputationScore: rep.score,
    paymentCount: payments.filter((p) => p.agentId === agentId).length,
    jobCount: mine.length,
    completedJobs: mine.filter((j) => j.status === 3).length,
  };
}

/** Ranked KYA for every agent seen in the payment + job stores. 60s cached. */
export async function listScores(opts: { limit?: number } = {}): Promise<ScoreRow[]> {
  const now = Date.now();
  if (!cache || cache.exp <= now) {
    const [payments, jobs] = (await Promise.all([listPayments(1000), listJobs(200)])) as [PaymentLike[], JobLike[]];
    const ids = new Set<string>();
    for (const p of payments) if (p.agentId) ids.add(p.agentId);
    for (const j of jobs) if (j.providerAgentId) ids.add(j.providerAgentId);
    const rows = await Promise.all([...ids].map((id) => computeRow(id, payments, jobs)));
    rows.sort((a, b) => b.kya - a.kya);
    cache = { rows: rows.map((r, i) => ({ ...r, rank: i + 1 })), exp: now + TTL_MS };
  }
  return opts.limit ? cache.rows.slice(0, opts.limit) : cache.rows;
}

/** KYA for one agent (may not be in the store list, e.g. a brand-new id). Rank is relative to listScores. */
export async function getScore(agentId: string): Promise<ScoreRow> {
  const [payments, jobs] = (await Promise.all([listPayments(1000), listJobs(200)])) as [PaymentLike[], JobLike[]];
  const row = await computeRow(agentId, payments, jobs);
  const all = await listScores();
  const rank = 1 + all.filter((r) => r.kya > row.kya).length;
  return { ...row, rank };
}

export function clearScoreCache(): void {
  cache = null;
}
