import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * Tiny JSON-file-backed payment store.
 *
 * The reference (circlefin/arc-nanopayments) persists payment events to Supabase.
 * For a zero-dependency weekend MVP we record them to ./.data/payments.json instead,
 * so the whole app runs with no external services. Swap this module for a real DB
 * (Supabase/Postgres) when you outgrow it — the interface is intentionally small.
 */

export interface PaymentEvent {
  id: string;
  endpoint: string;
  payer: string;
  amountUsdc: string;
  network: string;
  gatewayTx: string | null;
  /** ERC-8004 on-chain agent identity that made this payment, if presented. */
  agentId: string | null;
  agentAddress: string | null;
  /** GuardRail decision recorded with the settled payment (optional; absent for ungoverned endpoints). */
  decision?: "allow" | "escalate";
  policyTier?: string;
  remainingDaily?: number;
  ts: string;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "payments.json");
const MAX_EVENTS = 1000;

// Serialize read-modify-write so concurrent payments (the agent fires ~1/sec) don't clobber each other.
let lock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readAll(): Promise<PaymentEvent[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf-8")) as PaymentEvent[];
  } catch {
    return [];
  }
}

async function writeAll(events: PaymentEvent[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(events, null, 2));
}

export function recordPayment(
  e: Omit<PaymentEvent, "id" | "ts">,
): Promise<void> {
  return withLock(async () => {
    const events = await readAll();
    events.unshift({ ...e, id: randomUUID(), ts: new Date().toISOString() });
    await writeAll(events.slice(0, MAX_EVENTS));
  });
}

export async function listPayments(limit = 100): Promise<PaymentEvent[]> {
  return (await readAll()).slice(0, limit);
}

export interface Stats {
  totalUsdc: number;
  count: number;
  byEndpoint: Record<string, { count: number; totalUsdc: number }>;
}

export async function getStats(): Promise<Stats> {
  const events = await readAll();
  const byEndpoint: Stats["byEndpoint"] = {};
  let totalUsdc = 0;
  for (const e of events) {
    const amt = parseFloat(e.amountUsdc || "0");
    totalUsdc += amt;
    (byEndpoint[e.endpoint] ??= { count: 0, totalUsdc: 0 }).count++;
    byEndpoint[e.endpoint].totalUsdc += amt;
  }
  return { totalUsdc, count: events.length, byEndpoint };
}
