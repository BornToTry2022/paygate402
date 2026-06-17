import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { enqueueApproval, listPending, getApproval, resolveApproval } from "./approvals";

const FILE = path.join(process.cwd(), ".data", "pending-approvals.json");
const input = { endpoint: "/api/article/1", agentId: "668408", payer: "0xAA", amountUsdc: 0.5, reason: "over threshold" };

describe("approval queue", () => {
  beforeEach(async () => { await fs.rm(FILE, { force: true }); });
  afterEach(async () => { await fs.rm(FILE, { force: true }); });

  it("enqueues a pending approval and lists it", async () => {
    const a = await enqueueApproval(input);
    expect(a.status).toBe("pending");
    expect(a.id).toBeTruthy();
    const pending = await listPending();
    expect(pending.map((p) => p.id)).toContain(a.id);
  });

  it("approves an approval, removing it from pending", async () => {
    const a = await enqueueApproval(input);
    const resolved = await resolveApproval(a.id, true);
    expect(resolved?.status).toBe("approved");
    expect(resolved?.resolvedAt).toBeTruthy();
    expect((await listPending()).map((p) => p.id)).not.toContain(a.id);
    expect((await getApproval(a.id))?.status).toBe("approved");
  });

  it("denies an approval", async () => {
    const a = await enqueueApproval(input);
    expect((await resolveApproval(a.id, false))?.status).toBe("denied");
  });

  it("returns null when resolving an unknown id", async () => {
    expect(await resolveApproval("nope", true)).toBeNull();
  });

  it("ignores a re-resolve attempt on an already-resolved approval", async () => {
    const a = await enqueueApproval(input);
    const approved = await resolveApproval(a.id, true);
    const again = await resolveApproval(a.id, false); // attempt to flip to denied
    expect(again?.status).toBe("approved");
    expect(again?.resolvedAt).toBe(approved?.resolvedAt);
  });
});
