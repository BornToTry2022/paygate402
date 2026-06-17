import { describe, it, expect } from "vitest";
import { jobCompletionRate, paymentReliability, computeKya, KYA_WEIGHTS, type JobLike, type PaymentLike } from "./kya";

describe("jobCompletionRate", () => {
  const jobs: JobLike[] = [
    { providerAgentId: "1", status: 3 }, // completed
    { providerAgentId: "1", status: 3 }, // completed
    { providerAgentId: "1", status: 2 }, // submitted, not completed
    { providerAgentId: "1", status: 4 }, // rejected — NOT completed (stricter than getJobStats)
    { providerAgentId: "2", status: 3 }, // different agent
  ];
  it("is the fraction of the agent's provider jobs that reached status 3", () => {
    expect(jobCompletionRate(jobs, "1")).toBeCloseTo(2 / 4, 6);
  });
  it("is 0 when the agent has no provider jobs", () => {
    expect(jobCompletionRate(jobs, "999")).toBe(0);
  });
  it("does not count Rejected/Expired/Refunded (status >= 4) as completed", () => {
    expect(jobCompletionRate([{ providerAgentId: "x", status: 4 }, { providerAgentId: "x", status: 6 }], "x")).toBe(0);
  });
});

describe("paymentReliability", () => {
  const payments: PaymentLike[] = [{ agentId: "1" }, { agentId: "1" }, { agentId: "2" }, { agentId: null }];
  it("saturates at 1 when count reaches target", () => {
    expect(paymentReliability(payments, "1", 2)).toBe(1);
  });
  it("is the count over target below saturation", () => {
    expect(paymentReliability(payments, "1", 10)).toBeCloseTo(2 / 10, 6);
  });
  it("is 0 for an agent with no payments", () => {
    expect(paymentReliability(payments, "999", 10)).toBe(0);
  });
});

describe("computeKya", () => {
  it("returns 0 for an all-zero (minted-but-inactive) agent", () => {
    expect(computeKya({ reputationScore: 0, jobCompletionRate: 0, paymentReliability: 0 }).kya).toBe(0);
  });
  it("returns 100 for a perfect agent", () => {
    expect(computeKya({ reputationScore: 100, jobCompletionRate: 1, paymentReliability: 1 }).kya).toBe(100);
  });
  it("weights reputation 0.5 / jobCompletion 0.25 / paymentReliability 0.25", () => {
    // rep 100 only -> 0.5*100 = 50
    expect(computeKya({ reputationScore: 100, jobCompletionRate: 0, paymentReliability: 0 }).kya).toBe(50);
    // jobCompletion 1 only -> 0.25*100 = 25
    expect(computeKya({ reputationScore: 0, jobCompletionRate: 1, paymentReliability: 0 }).kya).toBe(25);
  });
  it("clamps a reputationScore above 100", () => {
    expect(computeKya({ reputationScore: 200, jobCompletionRate: 0, paymentReliability: 0 }).kya).toBe(50);
  });
  it("returns the clamped 0-1 breakdown", () => {
    const { breakdown } = computeKya({ reputationScore: 80, jobCompletionRate: 0.5, paymentReliability: 0.2 });
    expect(breakdown).toEqual({ reputation: 0.8, jobCompletion: 0.5, paymentReliability: 0.2 });
  });
  it("weights sum to 1", () => {
    expect(KYA_WEIGHTS.reputation + KYA_WEIGHTS.jobCompletion + KYA_WEIGHTS.paymentReliability).toBeCloseTo(1, 6);
  });
});
