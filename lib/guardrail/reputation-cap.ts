import type { GuardRailPolicy } from "./policy";

/**
 * Per-transaction spend cap (USD) scaled by an agent's 0–100 reputation:
 * baseCapUsd at score 0, rising linearly to maxCapUsd at score >= atScore.
 * Higher-trust agents are allowed larger single payments.
 */
export function reputationScaledCap(policy: GuardRailPolicy, score: number): number {
  const { baseCapUsd, maxCapUsd, atScore } = policy.reputationScaling;
  if (atScore <= 0) return maxCapUsd;
  const t = Math.max(0, Math.min(1, score / atScore));
  return baseCapUsd + (maxCapUsd - baseCapUsd) * t;
}
