import { getReputation } from "@/lib/reputation";
import { listPayments } from "@/lib/store";
import { loadPolicy } from "./policy";
import { evaluate, type GuardRailContext, type GuardRailDecision } from "./engine";
import { paymentKey, sumTodaysSpendUsd, countRecent } from "./signals";

/**
 * Gathers the three signals the pure engine needs (reputation score, today's
 * spend, recent payment count) from existing stores, then evaluates the policy.
 * Returns an `allow` decision immediately if the merchant has no enabled policy.
 */
export async function guardrailGate(ctx: GuardRailContext): Promise<GuardRailDecision> {
  const policy = await loadPolicy(ctx.merchantId);
  if (!policy.enabled) {
    return { decision: "allow", reason: "guardrail disabled", appliedTier: "n/a", remainingDaily: policy.dailyCapUsd };
  }

  const now = new Date();
  // NOTE: signals are keyed by agent/payer ONLY — not by merchant or endpoint.
  // PaymentEvent has no merchantId, so dailyCap and velocity aggregate an agent's
  // spend across ALL merchants/endpoints, not just this merchantId. This is fine
  // for the single-merchant ("press") demo; a future multi-merchant/fleet plan must
  // record merchantId on PaymentEvent and filter signals here if it needs isolation.
  const [score, payments] = await Promise.all([
    getReputation(ctx.agentId).then((r) => r.score),
    listPayments(1000),
  ]);
  const key = paymentKey({ payer: ctx.payer, agentId: ctx.agentId });

  return evaluate(policy, ctx, {
    reputationScore: score,
    todaysSpendUsd: sumTodaysSpendUsd(payments, key, now),
    recentCount: countRecent(payments, key, policy.velocity.windowMs, now),
  });
}
