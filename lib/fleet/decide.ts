/**
 * The research agent's buy/skip/escalate decision — the autonomy core.
 * Pure and import-free so it resolves under both vitest (`./decide`) and node
 * (`../lib/fleet/decide.ts` from agent/research-agent.mts).
 *
 * Order mirrors GuardRail: trust gate first, then escalate-before-cap (a too-large
 * spend asks a human rather than being silently skipped), then budget.
 */

export interface FleetPolicy {
  /** Skip articles whose publisher's AgentScore KYA is below this. */
  minPublisherKya: number;
  /** Skip a single article priced above this (and at/below the approval threshold). */
  perTxCapUsd: number;
  /** Stop buying once today's spend would exceed this. */
  dailyBudgetUsd: number;
  /** Escalate (ask a human) for a single article priced above this. */
  approvalThresholdUsd: number;
}

export interface BuyContext {
  articlePriceUsd: number;
  publisherKya: number;
  spentTodayUsd: number;
}

export interface BuyDecision {
  action: "buy" | "skip" | "escalate";
  reason: string;
}

export function decideBuy(ctx: BuyContext, policy: FleetPolicy): BuyDecision {
  if (ctx.publisherKya < policy.minPublisherKya) {
    return { action: "skip", reason: `publisher KYA ${ctx.publisherKya} < min ${policy.minPublisherKya}` };
  }
  if (ctx.articlePriceUsd > policy.approvalThresholdUsd) {
    return { action: "escalate", reason: `price $${ctx.articlePriceUsd} > approval threshold $${policy.approvalThresholdUsd}` };
  }
  if (ctx.articlePriceUsd > policy.perTxCapUsd) {
    return { action: "skip", reason: `price $${ctx.articlePriceUsd} > per-tx cap $${policy.perTxCapUsd}` };
  }
  if (ctx.spentTodayUsd + ctx.articlePriceUsd > policy.dailyBudgetUsd) {
    return { action: "skip", reason: `would exceed daily budget $${policy.dailyBudgetUsd}` };
  }
  return { action: "buy", reason: `KYA ${ctx.publisherKya} trusted, $${ctx.articlePriceUsd} within caps` };
}
