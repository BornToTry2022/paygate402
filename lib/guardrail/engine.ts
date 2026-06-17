import type { GuardRailPolicy } from "./policy";
import { reputationScaledCap } from "./reputation-cap";

export interface GuardRailContext {
  agentId: string | null;
  agentAddress: string | null;
  payer: string | null;
  merchantId: string;
  endpoint: string;
  amountUsdc: number;
}

export interface GuardRailSignals {
  reputationScore: number;
  todaysSpendUsd: number;
  recentCount: number;
}

export interface GuardRailDecision {
  decision: "allow" | "deny" | "escalate";
  reason: string;
  appliedTier: string;
  remainingDaily: number;
}

export function evaluate(
  policy: GuardRailPolicy,
  ctx: GuardRailContext,
  signals: GuardRailSignals,
): GuardRailDecision {
  const remainingDaily = Math.max(0, policy.dailyCapUsd - signals.todaysSpendUsd);
  const cap = reputationScaledCap(policy, signals.reputationScore);
  const appliedTier = `rep ${signals.reputationScore} → cap $${cap.toFixed(4)} · daily left $${remainingDaily.toFixed(4)}`;
  const base = { appliedTier, remainingDaily };

  if (!policy.enabled) return { decision: "allow", reason: "guardrail disabled", ...base };

  if (policy.allowlist.length > 0) {
    const payer = (ctx.payer ?? "").toLowerCase();
    if (!policy.allowlist.map((a) => a.toLowerCase()).includes(payer)) {
      return { decision: "deny", reason: `payer not on allowlist`, ...base };
    }
  }

  if (ctx.amountUsdc > policy.humanApprovalThresholdUsd) {
    return { decision: "escalate", reason: `amount $${ctx.amountUsdc} over approval threshold $${policy.humanApprovalThresholdUsd}`, ...base };
  }

  if (ctx.amountUsdc > cap) {
    return { decision: "deny", reason: `amount $${ctx.amountUsdc} over reputation cap $${cap.toFixed(4)}`, ...base };
  }

  if (signals.todaysSpendUsd + ctx.amountUsdc > policy.dailyCapUsd) {
    return { decision: "deny", reason: `daily cap $${policy.dailyCapUsd} exceeded`, ...base, remainingDaily: 0 };
  }

  if (signals.recentCount >= policy.velocity.maxCount) {
    return { decision: "deny", reason: `velocity limit ${policy.velocity.maxCount}/${policy.velocity.windowMs}ms exceeded`, ...base };
  }

  return { decision: "allow", reason: "within policy", ...base };
}

export function guardrailResponseFor(
  d: GuardRailDecision,
  endpoint: string,
): { status: number; body: Record<string, unknown> } | null {
  if (d.decision === "allow") return null;
  if (d.decision === "escalate") {
    return {
      status: 202,
      body: { status: "pending_approval", error: "GuardRail: payment escalated for human approval", endpoint, reason: d.reason },
    };
  }
  return {
    status: 403,
    body: { error: "GuardRail blocked this payment", endpoint, reason: d.reason, appliedTier: d.appliedTier, remainingDaily: d.remainingDaily },
  };
}
