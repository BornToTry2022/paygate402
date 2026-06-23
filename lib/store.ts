import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * Tiny JSON-backed payment store.
 *
 * The reference (circlefin/arc-nanopayments) persists payment events to Supabase.
 * For a zero-dependency MVP we record them to ./.data/payments.json locally, and
 * to Upstash Redis (one JSON blob) when KV env vars are set — the latter is what
 * lets the dashboard show real traction on a read-only serverless host (Vercel).
 *
 * The KV helpers below are an inlined copy of lib/kv.ts: this module is node
 * type-stripped directly (scripts/traction.mts imports `../lib/store.ts`), so it
 * must stay a leaf module and cannot import another lib `.ts` file. Keep in sync.
 */

// --- inlined KV backend (see lib/kv.ts for the shared copy + why this is duplicated) ---
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const KV_KEY = "paygate:payments";
function kvEnabled(): boolean {
  return Boolean(KV_URL && KV_TOKEN);
}
async function kvCommand<T>(cmd: unknown[]): Promise<T> {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`KV ${String(cmd[0])} failed: HTTP ${res.status}`);
  const json = (await res.json()) as { result: T; error?: string };
  if (json.error) throw new Error(`KV ${String(cmd[0])} error: ${json.error}`);
  return json.result;
}

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
  if (kvEnabled()) return kvCommand<string | null>(["GET", KV_KEY]).then((raw) => {
    if (raw == null) return [];
    try { return JSON.parse(raw) as PaymentEvent[]; } catch { return []; }
  });
  try {
    return JSON.parse(await fs.readFile(FILE, "utf-8")) as PaymentEvent[];
  } catch {
    return [];
  }
}

async function writeAll(events: PaymentEvent[]): Promise<void> {
  if (kvEnabled()) {
    await kvCommand(["SET", KV_KEY, JSON.stringify(events)]);
    return;
  }
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
