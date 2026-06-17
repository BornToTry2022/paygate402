import { describe, it, expect } from "vitest";
import { evaluate, guardrailResponseFor, type GuardRailContext, type GuardRailSignals } from "./engine";
import { DEFAULT_POLICY } from "./policy";

const policy = {
  ...DEFAULT_POLICY,
  merchantId: "press",
  enabled: true,
  allowlist: [],
  dailyCapUsd: 1.0,
  velocity: { maxCount: 3, windowMs: 10_000 },
  reputationScaling: { baseCapUsd: 0.01, maxCapUsd: 0.1, atScore: 80 },
  humanApprovalThresholdUsd: 0.25,
};
const ctx = (over: Partial<GuardRailContext> = {}): GuardRailContext => ({
  agentId: "668408", agentAddress: "0xAA", payer: "0xAA",
  merchantId: "press", endpoint: "/api/article/1", amountUsdc: 0.003, ...over,
});
const sig = (over: Partial<GuardRailSignals> = {}): GuardRailSignals => ({
  reputationScore: 80, todaysSpendUsd: 0, recentCount: 0, ...over,
});

describe("evaluate", () => {
  it("allows a normal in-policy payment", () => {
    const d = evaluate(policy, ctx(), sig());
    expect(d.decision).toBe("allow");
    expect(d.remainingDaily).toBeCloseTo(1.0, 6);
  });
  it("allows everything when the policy is disabled", () => {
    expect(evaluate({ ...policy, enabled: false }, ctx({ amountUsdc: 999 }), sig({ reputationScore: 0 })).decision).toBe("allow");
  });
  it("denies a payer not on a non-empty allowlist", () => {
    const d = evaluate({ ...policy, allowlist: ["0xbb"] }, ctx({ payer: "0xAA", agentId: null }), sig());
    expect(d.decision).toBe("deny");
    expect(d.reason).toMatch(/allowlist/i);
  });
  it("denies a payment above the reputation cap (low score) but below approval threshold", () => {
    // score 0 -> cap 0.01; amount 0.05 > cap, and 0.05 <= 0.25 threshold
    const d = evaluate(policy, ctx({ amountUsdc: 0.05 }), sig({ reputationScore: 0 }));
    expect(d.decision).toBe("deny");
    expect(d.reason).toMatch(/cap/i);
  });
  it("escalates a payment above the human-approval threshold", () => {
    const d = evaluate(policy, ctx({ amountUsdc: 0.5 }), sig({ reputationScore: 100 }));
    expect(d.decision).toBe("escalate");
  });
  it("escalates an above-threshold payment even from a low-reputation agent (escalate precedes cap-deny)", () => {
    // score 0 -> cap 0.01; amount 0.5 is over BOTH cap and the 0.25 threshold -> must escalate, not deny
    const d = evaluate(policy, ctx({ amountUsdc: 0.5 }), sig({ reputationScore: 0 }));
    expect(d.decision).toBe("escalate");
  });
  it("denies when the daily cap is already spent", () => {
    const d = evaluate(policy, ctx({ amountUsdc: 0.003 }), sig({ todaysSpendUsd: 1.0 }));
    expect(d.decision).toBe("deny");
    expect(d.reason).toMatch(/daily/i);
    expect(d.remainingDaily).toBe(0);
  });
  it("denies when velocity is exceeded", () => {
    const d = evaluate(policy, ctx(), sig({ recentCount: 3 }));
    expect(d.decision).toBe("deny");
    expect(d.reason).toMatch(/velocity|rate/i);
  });
});

describe("guardrailResponseFor", () => {
  it("returns null for allow", () => {
    expect(guardrailResponseFor({ decision: "allow", reason: "ok", appliedTier: "t", remainingDaily: 1 }, "/x")).toBeNull();
  });
  it("returns 403 for deny", () => {
    const r = guardrailResponseFor({ decision: "deny", reason: "over cap", appliedTier: "t", remainingDaily: 1 }, "/x");
    expect(r?.status).toBe(403);
    expect(r?.body.error).toMatch(/guardrail/i);
  });
  it("returns 202 for escalate", () => {
    const r = guardrailResponseFor({ decision: "escalate", reason: "needs approval", appliedTier: "t", remainingDaily: 1 }, "/x");
    expect(r?.status).toBe(202);
  });
});
