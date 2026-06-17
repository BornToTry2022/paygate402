import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadPolicy, savePolicy, DEFAULT_POLICY } from "./policy";

const FILE = path.join(process.cwd(), ".data", "policies.json");

describe("policy storage", () => {
  beforeEach(async () => { await fs.rm(FILE, { force: true }); });
  afterEach(async () => { await fs.rm(FILE, { force: true }); });

  it("returns DEFAULT_POLICY (with the merchantId) for an unknown merchant", async () => {
    const p = await loadPolicy("press");
    expect(p).toEqual({ ...DEFAULT_POLICY, merchantId: "press" });
  });

  it("round-trips a saved policy", async () => {
    const custom = { ...DEFAULT_POLICY, merchantId: "press", dailyCapUsd: 1.5, enabled: true };
    await savePolicy(custom);
    expect(await loadPolicy("press")).toEqual(custom);
  });

  it("keeps multiple merchants independent", async () => {
    await savePolicy({ ...DEFAULT_POLICY, merchantId: "a", dailyCapUsd: 2 });
    await savePolicy({ ...DEFAULT_POLICY, merchantId: "b", dailyCapUsd: 9 });
    expect((await loadPolicy("a")).dailyCapUsd).toBe(2);
    expect((await loadPolicy("b")).dailyCapUsd).toBe(9);
  });
});
