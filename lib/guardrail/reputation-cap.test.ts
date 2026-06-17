import { describe, it, expect } from "vitest";
import { reputationScaledCap } from "./reputation-cap";
import { DEFAULT_POLICY } from "./policy";

const P = { ...DEFAULT_POLICY, reputationScaling: { baseCapUsd: 0.01, maxCapUsd: 0.1, atScore: 80 } };

describe("reputationScaledCap", () => {
  it("returns base cap at score 0", () => {
    expect(reputationScaledCap(P, 0)).toBeCloseTo(0.01, 6);
  });
  it("returns max cap at/above atScore", () => {
    expect(reputationScaledCap(P, 80)).toBeCloseTo(0.1, 6);
    expect(reputationScaledCap(P, 100)).toBeCloseTo(0.1, 6);
  });
  it("interpolates linearly in between", () => {
    // halfway to atScore (40/80) -> halfway between 0.01 and 0.1 = 0.055
    expect(reputationScaledCap(P, 40)).toBeCloseTo(0.055, 6);
  });
  it("clamps negative scores to the base cap", () => {
    expect(reputationScaledCap(P, -5)).toBeCloseTo(0.01, 6);
  });
  it("returns max cap when atScore is 0 (avoid divide-by-zero)", () => {
    expect(reputationScaledCap({ ...P, reputationScaling: { baseCapUsd: 0.01, maxCapUsd: 0.1, atScore: 0 } }, 0)).toBeCloseTo(0.1, 6);
  });
});
