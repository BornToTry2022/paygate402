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

function shortAddr(a: string): string {
  return a && a.startsWith("0x") && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** One distinct paying party, keyed by stable identity (ERC-8004 agent id, else wallet). */
export interface PayerIdentity {
  /** "agent:<id>" for an ERC-8004 identity, else "addr:<lowercased wallet>". */
  key: string;
  kind: "agent" | "human";
  label: string;
  agentId: string | null;
  /** True when this payer is the project's own fleet/dogfood (not a real external user). */
  self: boolean;
  payments: number;
  usdc: number;
  firstTs: string;
  lastTs: string;
}

/**
 * Traction broken down by DISTINCT payer, and split into the project's own
 * dogfood (self) vs genuine external users — the number judges actually weigh.
 * The fleet pays from a fresh ephemeral wallet each run, so we key on the stable
 * ERC-8004 agent id (falling back to the wallet) — a looped self-agent collapses
 * to ONE identity instead of inflating a raw payment count.
 */
export interface Traction {
  distinctPayers: number;
  distinctExternalPayers: number;
  selfPayments: number;
  selfUsdc: number;
  externalPayments: number;
  externalUsdc: number;
  externalAgents: number;
  externalHumans: number;
  identities: PayerIdentity[];
}

export async function getTractionBreakdown(
  opts: { selfAgentIds?: string[]; selfAddrs?: string[] } = {},
): Promise<Traction> {
  const selfAgents = new Set((opts.selfAgentIds ?? []).map((s) => s.trim()).filter(Boolean));
  const selfAddrs = new Set((opts.selfAddrs ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean));
  const events = await readAll();
  const map = new Map<string, PayerIdentity>();
  for (const e of events) {
    const addr = (e.payer || "").toLowerCase();
    const key = e.agentId ? `agent:${e.agentId}` : `addr:${addr}`;
    const isSelf = (e.agentId != null && selfAgents.has(e.agentId)) || (addr !== "" && selfAddrs.has(addr));
    let id = map.get(key);
    if (!id) {
      id = {
        key,
        kind: e.agentId ? "agent" : "human",
        label: e.agentId ? `#${e.agentId}` : shortAddr(e.payer),
        agentId: e.agentId,
        self: isSelf,
        payments: 0,
        usdc: 0,
        firstTs: e.ts,
        lastTs: e.ts,
      };
      map.set(key, id);
    }
    id.payments++;
    id.usdc += parseFloat(e.amountUsdc || "0");
    if (e.ts < id.firstTs) id.firstTs = e.ts;
    if (e.ts > id.lastTs) id.lastTs = e.ts;
  }
  // External payers first, then by volume — surfaces real traction at the top.
  const identities = [...map.values()].sort(
    (a, b) => Number(a.self) - Number(b.self) || b.payments - a.payments,
  );
  const t: Traction = {
    distinctPayers: identities.length,
    distinctExternalPayers: identities.filter((i) => !i.self).length,
    selfPayments: 0,
    selfUsdc: 0,
    externalPayments: 0,
    externalUsdc: 0,
    externalAgents: identities.filter((i) => !i.self && i.kind === "agent").length,
    externalHumans: identities.filter((i) => !i.self && i.kind === "human").length,
    identities,
  };
  for (const i of identities) {
    if (i.self) {
      t.selfPayments += i.payments;
      t.selfUsdc += i.usdc;
    } else {
      t.externalPayments += i.payments;
      t.externalUsdc += i.usdc;
    }
  }
  return t;
}
