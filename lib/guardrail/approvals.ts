import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export interface Approval {
  id: string;
  endpoint: string;
  agentId: string | null;
  payer: string | null;
  amountUsdc: number;
  reason: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  resolvedAt: string | null;
}

const FILE = path.join(process.cwd(), ".data", "pending-approvals.json");
const MAX = 500;

let lock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.then(() => undefined, () => undefined);
  return run;
}

async function readAll(): Promise<Approval[]> {
  try { return JSON.parse(await fs.readFile(FILE, "utf-8")) as Approval[]; }
  catch { return []; }
}
async function writeAll(rows: Approval[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(rows.slice(0, MAX), null, 2));
}

export function enqueueApproval(
  input: Omit<Approval, "id" | "status" | "createdAt" | "resolvedAt">,
): Promise<Approval> {
  return withLock(async () => {
    const rows = await readAll();
    const approval: Approval = {
      ...input,
      id: randomUUID(),
      status: "pending",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    rows.unshift(approval);
    await writeAll(rows);
    return approval;
  });
}

export async function listPending(): Promise<Approval[]> {
  return (await readAll()).filter((a) => a.status === "pending");
}

export async function getApproval(id: string): Promise<Approval | null> {
  return (await readAll()).find((a) => a.id === id) ?? null;
}

export function resolveApproval(id: string, approve: boolean): Promise<Approval | null> {
  return withLock(async () => {
    const rows = await readAll();
    const row = rows.find((a) => a.id === id);
    if (!row) return null;
    if (row.status !== "pending") return row; // resolution is final; ignore re-resolve attempts
    row.status = approve ? "approved" : "denied";
    row.resolvedAt = new Date().toISOString();
    await writeAll(rows);
    return row;
  });
}
