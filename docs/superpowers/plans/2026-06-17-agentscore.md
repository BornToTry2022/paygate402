# AgentScore Implementation Plan (PressPay — Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AgentScore — a 0–100 Know-Your-Agent (KYA) trust oracle over the existing ERC-8004 reputation, ERC-8183 job history, and payment history — exposed as a free ranked **explorer** (`/explorer`, the "agent-economy Etherscan for Arc") and a **paywalled per-agent lookup** (`GET /api/score?agentId=…`, sold via the existing `withPaywall`, dogfooding the paywall). Deployable at the end.

**Architecture:** A pure scoring core (`kya.ts`) takes a 0–100 reputation score plus two 0–1 signals (job-completion rate, payment reliability) and returns a weighted 0–100 KYA + breakdown. A thin async indexer (`index.ts`) enumerates the agents seen in the payment/job stores, gathers each agent's signals (reusing `getReputation`, `listJobs`, `listPayments`), computes and ranks them with a 60s cache. A free `/api/scores` route feeds the explorer; a paywalled `/api/score` route serves a single agent's row. No new on-chain indexing infra — the existing JSON stores ARE the index.

**Tech Stack:** TypeScript (ESM), Next.js 16, React 19, viem, `@circle-fin/x402-batching`, vitest. Reuses GuardRail-era conventions.

## Global Constraints

- **Extensionless relative imports** in logic modules (`./kya`, NOT `./kya.ts`) — a `.ts` extension errors under `tsc`/`next build` (TS2307). `@/` alias only in runtime files (`index.ts`, route handlers, page). (An editor "cannot find module" warning on a NEW extensionless import is a known stale-LSP artifact; `tsc --noEmit` is the ground truth — it must report 0 errors.)
- **The scoring core (`kya.ts`) is pure and synchronous** — no I/O, no `await`, no `Date.now()`. All async I/O (RPC, file reads) lives in `index.ts`.
- **KYA formula (exact, tunable):** `kya = round( (0.5·repNorm + 0.25·jobCompletionRate + 0.25·paymentReliability) · 100 )` where `repNorm = clamp(reputationScore/100, 0, 1)`, both signals clamped to 0–1. Weights live in `KYA_WEIGHTS = { reputation: 0.5, jobCompletion: 0.25, paymentReliability: 0.25 }`.
- **Job completion is STRICT:** a job counts as completed only when `status === 3` (Completed). This is intentionally stricter than `lib/jobs.ts` `getJobStats` (which counts `status >= 3`, lumping in Rejected/Expired/Refunded). Filter the agent's jobs by `providerAgentId === agentId`.
- **Payment reliability** is activity-based (the store only records *successful* settlements): `min(1, paymentCount / RELIABILITY_TARGET)`, `RELIABILITY_TARGET = 10`, counting `PaymentEvent`s where `agentId === the agent`.
- **Existing signatures to reuse verbatim:** `getReputation(agentId): Promise<{agentId,count,score}>` (score 0–100); `listJobs(limit=50): Promise<JobRecord[]>` with `JobRecord.providerAgentId: string|null` and `JobRecord.status: number` (3 = Completed); `listPayments(limit=100): Promise<PaymentEvent[]>` with `PaymentEvent.agentId: string|null`; `withPaywall(handler, price, endpoint, opts?)`; `agentExplorerUrl(agentId)`; route pattern `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`.
- **Frequent commits:** one per task, prefix `feat(agentscore):` / `test(agentscore):` / `chore:`. Never stage the repo's pre-existing uncommitted `README.md`.

## File Structure

**New (logic — unit-tested, relative imports only):**
- `lib/agentscore/kya.ts` — `KYA_WEIGHTS`, `JobLike`, `PaymentLike`, `jobCompletionRate`, `paymentReliability`, `KyaBreakdown`, `computeKya` (all pure).

**New (Next-runtime — `@/` alias; index unit-tested via mocks, routes/page verified by running):**
- `lib/agentscore/index.ts` — `ScoreRow`, `getScore(agentId)`, `listScores(opts?)`, `clearScoreCache()` (gathers signals via `@/lib/reputation`, `@/lib/jobs`, `@/lib/store`).
- `app/api/scores/route.ts` — free `GET` → `listScores({limit})` (explorer feed).
- `app/api/score/route.ts` — paywalled `GET` (`withPaywall`, `$0.001`) → `getScore(?agentId=…)`.
- `app/explorer/page.tsx` — ranked agent cards (KYA, breakdown, rank, counts, explorer link), polled.

**Modified:** none (AgentScore is purely additive; it reads existing stores).

## Out of scope (YAGNI / deferred)

- **Agent metadata (name/avatar via `tokenURI`)** — nice-to-have explorer polish; testnet `tokenURI` often won't resolve to rich cards. The explorer links to `agentExplorerUrl(agentId)` instead. Add later if it improves the demo.
- **Wiring AgentScore back into GuardRail's reputation-scaled cap** — deferred to Plan 3 (the research-agent fleet), where the "AgentScore feeds the buy/skip decision" story is told end-to-end. GuardRail keeps using raw ERC-8004 reputation for now.
- **Real event-log backfill / on-chain enumeration of all agents** — the index is the set of agents seen in the payment + job stores (sufficient on a sparse testnet and for the demo fleet). Documented, not hidden.

---

### Task 1: KYA scoring core (pure)

**Files:**
- Create: `lib/agentscore/kya.ts`
- Test: `lib/agentscore/kya.test.ts`

**Interfaces:**
- Produces: `KYA_WEIGHTS`; `type JobLike = { providerAgentId: string|null; status: number }`; `type PaymentLike = { agentId: string|null }`; `jobCompletionRate(jobs: JobLike[], agentId: string): number`; `paymentReliability(payments: PaymentLike[], agentId: string, target?: number): number`; `interface KyaBreakdown { reputation: number; jobCompletion: number; paymentReliability: number }`; `computeKya(input: { reputationScore: number; jobCompletionRate: number; paymentReliability: number }): { kya: number; breakdown: KyaBreakdown }`.

- [ ] **Step 1: Write the failing test** — `lib/agentscore/kya.test.ts`

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./kya`.

- [ ] **Step 3: Implement `lib/agentscore/kya.ts`**

```ts
/**
 * Pure KYA (Know-Your-Agent) scoring. Given a 0–100 reputation score and two
 * 0–1 activity signals, produce a weighted 0–100 trust score + its breakdown.
 * No I/O — the indexer (index.ts) gathers the inputs.
 */

export const KYA_WEIGHTS = { reputation: 0.5, jobCompletion: 0.25, paymentReliability: 0.25 } as const;

/** Minimal shapes so this pure core never imports the full @/ store modules. */
export type JobLike = { providerAgentId: string | null; status: number };
export type PaymentLike = { agentId: string | null };

/** Fraction (0–1) of the agent's PROVIDER jobs that reached Completed (status === 3). 0 if none. */
export function jobCompletionRate(jobs: JobLike[], agentId: string): number {
  const mine = jobs.filter((j) => j.providerAgentId === agentId);
  if (mine.length === 0) return 0;
  const completed = mine.filter((j) => j.status === 3).length;
  return completed / mine.length;
}

/** Activity-based reliability (0–1): successful payments by the agent, saturating at `target`. */
export function paymentReliability(payments: PaymentLike[], agentId: string, target = 10): number {
  const n = payments.filter((p) => p.agentId === agentId).length;
  return Math.min(1, n / target);
}

export interface KyaBreakdown {
  reputation: number;
  jobCompletion: number;
  paymentReliability: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Weighted 0–100 KYA from a 0–100 reputation score and two 0–1 signals. */
export function computeKya(input: {
  reputationScore: number;
  jobCompletionRate: number;
  paymentReliability: number;
}): { kya: number; breakdown: KyaBreakdown } {
  const breakdown: KyaBreakdown = {
    reputation: clamp01(input.reputationScore / 100),
    jobCompletion: clamp01(input.jobCompletionRate),
    paymentReliability: clamp01(input.paymentReliability),
  };
  const kya = Math.round(
    (KYA_WEIGHTS.reputation * breakdown.reputation +
      KYA_WEIGHTS.jobCompletion * breakdown.jobCompletion +
      KYA_WEIGHTS.paymentReliability * breakdown.paymentReliability) *
      100,
  );
  return { kya, breakdown };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS (all kya + prior guardrail tests green).

- [ ] **Step 5: Commit**

```bash
git add lib/agentscore/kya.ts lib/agentscore/kya.test.ts
git commit -m "feat(agentscore): pure KYA scoring core (reputation + jobs + payments)"
```

---

### Task 2: AgentScore indexer (async wiring)

**Files:**
- Create: `lib/agentscore/index.ts`
- Test: `lib/agentscore/index.test.ts`

**Interfaces:**
- Consumes: `@/lib/reputation#getReputation`, `@/lib/jobs#listJobs`, `@/lib/store#listPayments`; `./kya`.
- Produces:
  - `interface ScoreRow { agentId: string; kya: number; breakdown: KyaBreakdown; reputationScore: number; paymentCount: number; jobCount: number; completedJobs: number; rank: number }`
  - `getScore(agentId: string): Promise<ScoreRow>`
  - `listScores(opts?: { limit?: number }): Promise<ScoreRow[]>`
  - `clearScoreCache(): void`

This file uses the `@/` alias. The test mocks the three `@/` deps via `vi.mock`.

- [ ] **Step 1: Write the failing test** — `lib/agentscore/index.test.ts`

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Implement `lib/agentscore/index.ts`**

```ts
import { getReputation } from "@/lib/reputation";
import { listJobs } from "@/lib/jobs";
import { listPayments } from "@/lib/store";
import { computeKya, jobCompletionRate, paymentReliability, type JobLike, type PaymentLike, type KyaBreakdown } from "./kya";

export interface ScoreRow {
  agentId: string;
  kya: number;
  breakdown: KyaBreakdown;
  reputationScore: number;
  paymentCount: number;
  jobCount: number;
  completedJobs: number;
  rank: number;
}

const TTL_MS = 60_000;
let cache: { rows: ScoreRow[]; exp: number } | null = null;

async function computeRow(
  agentId: string,
  payments: PaymentLike[],
  jobs: JobLike[],
): Promise<Omit<ScoreRow, "rank">> {
  const rep = await getReputation(agentId);
  const { kya, breakdown } = computeKya({
    reputationScore: rep.score,
    jobCompletionRate: jobCompletionRate(jobs, agentId),
    paymentReliability: paymentReliability(payments, agentId),
  });
  const mine = jobs.filter((j) => j.providerAgentId === agentId);
  return {
    agentId,
    kya,
    breakdown,
    reputationScore: rep.score,
    paymentCount: payments.filter((p) => p.agentId === agentId).length,
    jobCount: mine.length,
    completedJobs: mine.filter((j) => j.status === 3).length,
  };
}

/** Ranked KYA for every agent seen in the payment + job stores. 60s cached. */
export async function listScores(opts: { limit?: number } = {}): Promise<ScoreRow[]> {
  const now = Date.now();
  if (!cache || cache.exp <= now) {
    const [payments, jobs] = (await Promise.all([listPayments(1000), listJobs(200)])) as [PaymentLike[], JobLike[]];
    const ids = new Set<string>();
    for (const p of payments) if (p.agentId) ids.add(p.agentId);
    for (const j of jobs) if (j.providerAgentId) ids.add(j.providerAgentId);
    const rows = await Promise.all([...ids].map((id) => computeRow(id, payments, jobs)));
    rows.sort((a, b) => b.kya - a.kya);
    cache = { rows: rows.map((r, i) => ({ ...r, rank: i + 1 })), exp: now + TTL_MS };
  }
  return opts.limit ? cache.rows.slice(0, opts.limit) : cache.rows;
}

/** KYA for one agent (may not be in the store list, e.g. a brand-new id). Rank is relative to listScores. */
export async function getScore(agentId: string): Promise<ScoreRow> {
  const [payments, jobs] = (await Promise.all([listPayments(1000), listJobs(200)])) as [PaymentLike[], JobLike[]];
  const row = await computeRow(agentId, payments, jobs);
  const all = await listScores();
  const rank = 1 + all.filter((r) => r.kya > row.kya).length;
  return { ...row, rank };
}

export function clearScoreCache(): void {
  cache = null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/agentscore/index.ts lib/agentscore/index.test.ts
git commit -m "feat(agentscore): indexer that ranks agents by KYA over existing stores"
```

---

### Task 3: Score API — free `/api/scores` + paywalled `/api/score`

**Files:**
- Create: `app/api/scores/route.ts`
- Create: `app/api/score/route.ts`
- Test: manual (curl against `npm run dev`)

**Interfaces:**
- Consumes: `listScores`, `getScore` (from `@/lib/agentscore`), `withPaywall` (from `@/lib/paywall`).

- [ ] **Step 1: Create `app/api/scores/route.ts`** (free explorer feed)

```ts
import { NextRequest, NextResponse } from "next/server";
import { listScores } from "@/lib/agentscore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Free ranked KYA feed for the explorer (browsing is free; programmatic per-agent lookups are paywalled). */
export async function GET(req: NextRequest) {
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(200, Number(limitParam) || 50)) : undefined;
  return NextResponse.json({ scores: await listScores({ limit }) });
}
```

- [ ] **Step 2: Create `app/api/score/route.ts`** (paywalled per-agent lookup)

```ts
import { NextRequest, NextResponse } from "next/server";
import { withPaywall } from "@/lib/paywall";
import { getScore } from "@/lib/agentscore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(req: NextRequest): Promise<NextResponse> {
  const agentId = req.nextUrl.searchParams.get("agentId");
  if (!agentId || !/^\d+$/.test(agentId)) {
    return NextResponse.json({ error: "numeric agentId query param required" }, { status: 400 });
  }
  return NextResponse.json(await getScore(agentId));
}

/** Pay $0.001 in USDC to read a specific agent's KYA score — AgentScore dogfooding the paywall. */
export const GET = withPaywall(handler, "$0.001", "/api/score");
```

- [ ] **Step 3: Verify both endpoints via curl** (`npm run dev` running in the background)

```bash
# Free explorer feed → 200 with a {scores:[...]} array (possibly empty on a fresh store).
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/scores"
curl -s "http://localhost:3000/api/scores" | head -c 200
# Paywalled lookup with no payment → 402.
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/score?agentId=1"
# Bad agentId → 402 first (payment is checked before the handler runs), so validate the handler path is reachable by confirming the 402 carries the PAYMENT-REQUIRED header:
curl -s -D - -o /dev/null "http://localhost:3000/api/score?agentId=1" | grep -i "payment-required" | head -1
```

Expected: `/api/scores` → `200` and a JSON object with a `scores` array; `/api/score?agentId=1` → `402` with a `PAYMENT-REQUIRED` header. Kill the dev server when done.

- [ ] **Step 4: Confirm the unit suite + types are still green**

Run: `npm test` (all green) and `npx tsc --noEmit` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add app/api/scores/route.ts app/api/score/route.ts
git commit -m "feat(agentscore): free scores feed and paywalled per-agent score endpoint"
```

---

### Task 4: Explorer page + build verification

**Files:**
- Create: `app/explorer/page.tsx`
- Test: manual (visual, via `npm run dev`) + `npm run build`

**Interfaces:**
- Consumes: `GET /api/scores`.

- [ ] **Step 1: Create `app/explorer/page.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";

type Breakdown = { reputation: number; jobCompletion: number; paymentReliability: number };
type ScoreRow = {
  agentId: string; kya: number; breakdown: Breakdown; reputationScore: number;
  paymentCount: number; jobCount: number; completedJobs: number; rank: number;
};

const EXPLORER = (agentId: string) =>
  `https://testnet.arcscan.app/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/${agentId}`;

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: "2px 0" }}>
      <span style={{ width: 86, color: "#666" }}>{label}</span>
      <span style={{ flex: 1, height: 8, background: "#eee", borderRadius: 4, overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${Math.round(value * 100)}%`, background: "#5b8def" }} />
      </span>
      <span style={{ width: 36, textAlign: "right", color: "#888" }}>{Math.round(value * 100)}</span>
    </div>
  );
}

export default function ExplorerPage() {
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function refresh() {
      const data = await fetch("/api/scores").then((r) => r.json()).catch(() => ({ scores: [] }));
      setRows(Array.isArray(data.scores) ? data.scores : []);
      setLoaded(true);
    }
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <main style={{ maxWidth: 820, margin: "2rem auto", fontFamily: "ui-sans-serif, system-ui", padding: "0 1rem" }}>
      <h1>AgentScore — KYA trust explorer</h1>
      <p style={{ color: "#666" }}>
        A 0–100 Know-Your-Agent score over ERC-8004 reputation, ERC-8183 job completion, and payment reliability.
        Browsing is free; programmatic per-agent lookups are paywalled at <code>/api/score</code>.
      </p>
      {loaded && rows.length === 0 && <p style={{ color: "#888" }}>No scored agents yet — drive some payments/jobs to populate.</p>}
      {rows.map((r) => (
        <section key={r.agentId} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, margin: "12px 0", display: "flex", gap: 16 }}>
          <div style={{ textAlign: "center", minWidth: 70 }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: r.kya >= 67 ? "#1a8a4a" : r.kya >= 34 ? "#b8860b" : "#b33" }}>{r.kya}</div>
            <div style={{ fontSize: 11, color: "#999" }}>KYA · #{r.rank}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>
              <a href={EXPLORER(r.agentId)} target="_blank" rel="noreferrer">agent #{r.agentId}</a>
              <span style={{ color: "#999", fontWeight: 400, fontSize: 12 }}>
                {" "}· {r.completedJobs}/{r.jobCount} jobs · {r.paymentCount} payments · rep {r.reputationScore}
              </span>
            </div>
            <Bar label="reputation" value={r.breakdown.reputation} />
            <Bar label="jobs" value={r.breakdown.jobCompletion} />
            <Bar label="payments" value={r.breakdown.paymentReliability} />
          </div>
        </section>
      ))}
    </main>
  );
}
```

- [ ] **Step 2: Verify visually** (`npm run dev`)

Open `http://localhost:3000/explorer`. Expected: page renders with the title and either ranked agent cards (KYA number + colored, rank, three breakdown bars, an arcscan link) or the empty-state message on a fresh store. Confirm via curl too:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/explorer   # 200
curl -s http://localhost:3000/explorer | grep -o "AgentScore" | head -1   # matches
```

Kill the dev server when done.

- [ ] **Step 3: Production build + final type/test gate**

```bash
npm test          # all green (kya + index + guardrail)
npx tsc --noEmit  # 0 errors
npm run build     # succeeds; /explorer, /api/scores, /api/score all appear in the route list
```

Expected: build succeeds with `/explorer` (Static or Dynamic), `ƒ /api/scores`, and `ƒ /api/score` listed.

- [ ] **Step 4: Commit**

```bash
git add app/explorer/page.tsx
git commit -m "feat(agentscore): KYA trust explorer page"
```

---

## Self-Review (completed by author)

**Spec coverage (vs `2026-06-17-presspay-design.md` §4 Component 2):**
- 0–100 KYA from reputation + job-completion + payment reliability → Task 1 (`computeKya`, weights 0.5/0.25/0.25). ✓
- Indexer over ERC-8004 + ERC-8183 + payment history, reusing `getReputation`/`listJobs`/`listPayments` → Task 2. ✓
- `getScore(agentId)` + `listScores({sort,limit})` interface → Task 2 (sort is fixed desc-by-KYA, which is the only sort the explorer needs — `sort` param omitted as YAGNI). ✓
- Explorer UI ("agent-economy Etherscan") → Task 4. ✓
- `/api/score` sold via `withPaywall` (dogfooding) → Task 3 (paywalled `GET`, `$0.001`); free `/api/scores` added for the free explorer feed. ✓
- "Scores a brand-new minted agent near zero" (the minted-but-inactive demo) → Task 2 test + Task 1 all-zero test. ✓
- 60s recompute-on-read cache → Task 2. ✓

**Deliberate deviations from the design (documented above in Out of scope):** metadata via `tokenURI` deferred (testnet resolution + scope); AgentScore→GuardRail wiring deferred to Plan 3; agent enumeration is store-derived (not full on-chain backfill). The KYA weights are 0.5/0.25/0.25 per the spec's §3 default.

**Placeholder scan:** none — every code step is complete; curl/visual verifications have exact commands + expected output.

**Type consistency:** `JobLike`/`PaymentLike`/`KyaBreakdown` from `kya.ts` are reused by `index.ts`; `ScoreRow` fields match between `index.ts`, the routes, and the explorer page; `computeKya` input/return shape matches its call site in `computeRow`. `JobRecord.status === 3` (Completed) and `PaymentEvent.agentId`/`JobRecord.providerAgentId` match the real `lib/jobs.ts`/`lib/store.ts` signatures.
