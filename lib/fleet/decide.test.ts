import { describe, it, expect } from "vitest";
import { decideBuy, type FleetPolicy, type BuyContext } from "./decide";

const policy: FleetPolicy = { minPublisherKya: 50, perTxCapUsd: 0.01, dailyBudgetUsd: 0.5, approvalThresholdUsd: 0.05 };
const ctx = (over: Partial<BuyContext> = {}): BuyContext => ({ articlePriceUsd: 0.003, publisherKya: 82, spentTodayUsd: 0, ...over });

describe("decideBuy", () => {
  it("buys a trusted-publisher, in-budget article", () => {
    expect(decideBuy(ctx(), policy).action).toBe("buy");
  });
  it("skips a low-trust publisher", () => {
    const d = decideBuy(ctx({ publisherKya: 31 }), policy);
    expect(d.action).toBe("skip");
    expect(d.reason).toMatch(/kya/i);
  });
  it("escalates a price over the approval threshold (even from a trusted publisher)", () => {
    const d = decideBuy(ctx({ articlePriceUsd: 0.08 }), policy);
    expect(d.action).toBe("escalate");
  });
  it("skips a price over the per-tx cap but under the approval threshold", () => {
    // cap 0.01 < price 0.02 < threshold 0.05 -> skip (not escalate)
    expect(decideBuy(ctx({ articlePriceUsd: 0.02 }), policy).action).toBe("skip");
  });
  it("skips when the purchase would exceed the daily budget", () => {
    const d = decideBuy(ctx({ spentTodayUsd: 0.499 }), policy);
    expect(d.action).toBe("skip");
    expect(d.reason).toMatch(/budget/i);
  });
});
