import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/reputation", () => ({ getReputation: vi.fn() }));
vi.mock("@/lib/store", () => ({ listPayments: vi.fn() }));
vi.mock("./policy", async (orig) => {
  const real = await orig<typeof import("./policy")>();
  return { ...real, loadPolicy: vi.fn() };
});

import { getReputation } from "@/lib/reputation";
import { listPayments } from "@/lib/store";
import { loadPolicy, DEFAULT_POLICY } from "./policy";
import { guardrailGate } from "./gate";

const enabled = { ...DEFAULT_POLICY, merchantId: "press", enabled: true, dailyCapUsd: 1, humanApprovalThresholdUsd: 0.25, reputationScaling: { baseCapUsd: 0.01, maxCapUsd: 0.1, atScore: 80 } };
const ctx = { agentId: "668408", agentAddress: "0xAA", payer: "0xAA", merchantId: "press", endpoint: "/api/article/1", amountUsdc: 0.003 };

beforeEach(() => { vi.clearAllMocks(); });

describe("guardrailGate", () => {
  it("allows when policy disabled without reading reputation", async () => {
    (loadPolicy as any).mockResolvedValue({ ...enabled, enabled: false });
    const d = await guardrailGate(ctx);
    expect(d.decision).toBe("allow");
    expect(getReputation).not.toHaveBeenCalled();
  });

  it("gathers reputation + spend and allows an in-policy payment", async () => {
    (loadPolicy as any).mockResolvedValue(enabled);
    (getReputation as any).mockResolvedValue({ agentId: "668408", count: 3, score: 80 });
    (listPayments as any).mockResolvedValue([]);
    const d = await guardrailGate(ctx);
    expect(d.decision).toBe("allow");
  });

  it("denies when today's spend (from the store) exhausts the daily cap", async () => {
    (loadPolicy as any).mockResolvedValue(enabled);
    (getReputation as any).mockResolvedValue({ agentId: "668408", count: 3, score: 80 });
    (listPayments as any).mockResolvedValue([
      { payer: "0xAA", agentId: "668408", amountUsdc: "1.0", ts: new Date().toISOString() },
    ]);
    const d = await guardrailGate(ctx);
    expect(d.decision).toBe("deny");
    expect(d.reason).toMatch(/daily/i);
  });
});
