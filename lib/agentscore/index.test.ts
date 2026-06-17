import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/reputation", () => ({ getReputation: vi.fn() }));
vi.mock("@/lib/jobs", () => ({ listJobs: vi.fn() }));
vi.mock("@/lib/store", () => ({ listPayments: vi.fn() }));

import { getReputation } from "@/lib/reputation";
import { listJobs } from "@/lib/jobs";
import { listPayments } from "@/lib/store";
import { getScore, listScores, clearScoreCache } from "./index";

beforeEach(() => {
  vi.clearAllMocks();
  clearScoreCache();
  // default reputation: agent "1" strong, everyone else 0
  (getReputation as any).mockImplementation(async (id: string) => ({ agentId: id, count: id === "1" ? 3 : 0, score: id === "1" ? 80 : 0 }));
  (listJobs as any).mockResolvedValue([
    { providerAgentId: "1", status: 3 },
    { providerAgentId: "1", status: 3 },
  ]);
  (listPayments as any).mockResolvedValue([
    { agentId: "1" }, { agentId: "1" }, { agentId: "2" },
  ]);
});

describe("listScores", () => {
  it("enumerates agents from payments + jobs and ranks by KYA desc", async () => {
    const rows = await listScores();
    expect(rows.map((r) => r.agentId).sort()).toEqual(["1", "2"]);
    expect(rows[0].agentId).toBe("1"); // highest KYA first
    expect(rows[0].rank).toBe(1);
    expect(rows[1].rank).toBe(2);
    expect(rows[0].kya).toBeGreaterThan(rows[1].kya);
  });
  it("respects the limit option", async () => {
    expect((await listScores({ limit: 1 })).length).toBe(1);
  });
});

describe("getScore", () => {
  it("returns a row with breakdown and counts for a specific agent", async () => {
    const r = await getScore("1");
    expect(r.agentId).toBe("1");
    expect(r.reputationScore).toBe(80);
    expect(r.completedJobs).toBe(2);
    expect(r.jobCount).toBe(2);
    expect(r.paymentCount).toBe(2);
    expect(r.kya).toBeGreaterThan(0);
    expect(r.rank).toBe(1);
  });
  it("scores a brand-new minted-but-inactive agent near zero", async () => {
    const r = await getScore("404"); // no rep, no jobs, no payments
    expect(r.kya).toBe(0);
    expect(r.paymentCount).toBe(0);
    expect(r.jobCount).toBe(0);
  });
});
