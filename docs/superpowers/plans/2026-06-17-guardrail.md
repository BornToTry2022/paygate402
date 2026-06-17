# GuardRail Implementation Plan (PressPay — Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GuardRail — a reputation-aware spend-policy firewall — to the existing PayGate402 paywall, so every agent payment is evaluated (allow / deny / escalate-to-human) before it settles, with a live dashboard and admin API. Deployable by the end of this plan.

**Architecture:** A pure, synchronous decision core (`evaluate`) takes a policy + payment context + three numeric signals (reputation score, today's spend, recent payment count) and returns a decision. A thin async `gate` gathers those signals from existing modules (`getReputation`, `listPayments`). `withPaywall` calls the gate right after `facilitator.verify` succeeds and before `facilitator.settle`: `deny` → 403, `escalate` → enqueue to a persistent approval queue + 202, `allow` → settle as today. Everything is a no-op unless a per-merchant policy is enabled, so existing endpoints keep working untouched.

**Tech Stack:** TypeScript (ESM), Next.js 16, React 19, viem, `@circle-fin/x402-batching`, JSON-file stores under `.data/`. Tests: **vitest** (added in Task 1).

## Global Constraints

- **No `@/` path alias inside unit-tested logic modules.** Tested modules (`lib/guardrail/{policy,reputation-cap,signals,engine,approvals}.ts`) import each other with **extensionless relative** paths (e.g. `./policy`, NOT `./policy.ts`) and never import `@/lib/...`. Only the Next-runtime files (`gate.ts`, `paywall.ts`, route handlers, the page) use the `@/` alias. (vitest/Vite resolves extensionless `.ts` imports; a `.ts` extension in the specifier errors under `tsc`/`next build` with TS2307, so never write it.)
- **The decision core is pure and synchronous.** `evaluate(policy, ctx, signals)` performs no I/O and no `await`. All async I/O (RPC, file reads) happens in `gate.ts`.
- **GuardRail defaults to off.** With no enabled policy for a merchant, the gate returns an `allow` decision with reason `"guardrail disabled"` and nothing in the existing payment flow changes.
- **USDC amounts are dollars as `number`** at the GuardRail layer (e.g. `0.003`), NOT atomic units. Convert at the boundary only.
- **Money/day boundary is UTC.** "Today" = same `YYYY-MM-DD` in UTC as `now`.
- **Existing values to reuse verbatim:** `ARC.network = "eip155:5042002"`; USDC has 6 decimals as ERC-20; `getReputation(agentId): Promise<{agentId,count,score}>` (score is 0–100); `recordPayment(e: Omit<PaymentEvent,"id"|"ts">): Promise<void>`; `listPayments(limit=100): Promise<PaymentEvent[]>`; `PaymentEvent` has `payer, amountUsdc (string), agentId, agentAddress, endpoint, ts (ISO)`.
- **Frequent commits:** one commit per task, message prefix `feat(guardrail):` or `test(guardrail):` / `chore:`.

## Prerequisites (ops, not code — do once, in parallel with Task 1)

- Hackathon registration done (Luma code `LEPTONHOUSE`, both Discords) — unblocks testnet faucet/tooling.
- Circle CLI installed for later plans: `npm install -g @circle-fin/cli` (Node ≥ 20.18.2). **Not used in this plan** (Agent Wallets land in the fleet plan); listed here only so it's ready.

## File Structure

**New (logic — unit-tested, relative imports only):**
- `lib/guardrail/policy.ts` — `GuardRailPolicy` type, `DEFAULT_POLICY`, `loadPolicy`, `savePolicy` (persists `.data/policies.json`).
- `lib/guardrail/reputation-cap.ts` — `reputationScaledCap(policy, score): number` (pure).
- `lib/guardrail/signals.ts` — `sumTodaysSpendUsd`, `countRecent` (pure, over `PaymentEvent[]`).
- `lib/guardrail/engine.ts` — `GuardRailContext`, `GuardRailSignals`, `GuardRailDecision`, `evaluate(...)` (pure), `guardrailResponseFor(decision, endpoint)` (pure HTTP mapping).
- `lib/guardrail/approvals.ts` — persistent approval queue (`.data/pending-approvals.json`): `enqueueApproval`, `listPending`, `getApproval`, `resolveApproval`.

**New (Next-runtime — verified by running, `@/` alias allowed):**
- `lib/guardrail/gate.ts` — `guardrailGate(ctx): Promise<GuardRailDecision>` (gathers signals via `@/lib/reputation`, `@/lib/store`, `loadPolicy`).
- `app/api/guardrail/policies/route.ts` — `GET` (list/one) + `PUT` (upsert) policies.
- `app/api/guardrail/pending/route.ts` — `GET` pending approvals.
- `app/api/guardrail/approve/route.ts` — `POST` `{id, approve: boolean}` to resolve one.
- `app/guardrail/page.tsx` — dashboard: policy editor + live allow/block/escalate feed + approve buttons.

**Modified:**
- `lib/store.ts` — extend `PaymentEvent` with optional `decision?`, `policyTier?`, `remainingDaily?`.
- `lib/paywall.ts` — add `guardrail?` to `PaywallOpts`; interpose `guardrailGate` between verify and settle (~15 lines); pass decision fields to `recordPayment`.
- `package.json` — add `vitest` devDep + `"test"` script.

**New config:**
- `vitest.config.ts`.

---

### Task 1: Test harness + policy storage

**Files:**
- Modify: `package.json` (add devDep + script)
- Create: `vitest.config.ts`
- Create: `lib/guardrail/policy.ts`
- Test: `lib/guardrail/policy.test.ts`

**Interfaces:**
- Produces: `GuardRailPolicy`, `DEFAULT_POLICY`, `loadPolicy(merchantId: string): Promise<GuardRailPolicy>`, `savePolicy(policy: GuardRailPolicy): Promise<void>`.

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`
Expected: `package.json` gains `"vitest"` under `devDependencies`; no errors.

- [ ] **Step 2: Add the test script to `package.json`**

In the `"scripts"` block add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(process.cwd()) } },
  test: { environment: "node", include: ["lib/**/*.test.ts"] },
});
```

- [ ] **Step 4: Write the failing test** — `lib/guardrail/policy.test.ts`

```ts
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
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./policy.ts` (module not yet created).

- [ ] **Step 6: Implement `lib/guardrail/policy.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";

/** A per-merchant spend policy GuardRail enforces before settlement. */
export interface GuardRailPolicy {
  merchantId: string;
  /** When false, the gate is a no-op (allow everything). */
  enabled: boolean;
  /** Lowercased payer/agent addresses allowed to pay; empty array = allow all. */
  allowlist: string[];
  /** Max total USD an agent may spend at this merchant per UTC day. */
  dailyCapUsd: number;
  /** Rate limit: at most `maxCount` payments per `windowMs` per agent. */
  velocity: { maxCount: number; windowMs: number };
  /** Per-tx cap scales linearly from baseCapUsd (score 0) to maxCapUsd (score >= atScore). */
  reputationScaling: { baseCapUsd: number; maxCapUsd: number; atScore: number };
  /** Per-tx USD amount above which the payment is escalated to a human. */
  humanApprovalThresholdUsd: number;
}

export const DEFAULT_POLICY: GuardRailPolicy = {
  merchantId: "",
  enabled: false,
  allowlist: [],
  dailyCapUsd: 1.0,
  velocity: { maxCount: 20, windowMs: 10_000 },
  reputationScaling: { baseCapUsd: 0.01, maxCapUsd: 0.1, atScore: 80 },
  humanApprovalThresholdUsd: 0.25,
};

const FILE = path.join(process.cwd(), ".data", "policies.json");

async function readAll(): Promise<Record<string, GuardRailPolicy>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf-8")) as Record<string, GuardRailPolicy>;
  } catch {
    return {};
  }
}

export async function loadPolicy(merchantId: string): Promise<GuardRailPolicy> {
  const all = await readAll();
  return all[merchantId] ?? { ...DEFAULT_POLICY, merchantId };
}

export async function savePolicy(policy: GuardRailPolicy): Promise<void> {
  const all = await readAll();
  all[policy.merchantId] = policy;
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2));
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test`
Expected: PASS (3 passing).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts lib/guardrail/policy.ts lib/guardrail/policy.test.ts
git commit -m "feat(guardrail): add vitest harness and per-merchant policy storage"
```

---

### Task 2: Reputation-scaled per-tx cap (pure)

**Files:**
- Create: `lib/guardrail/reputation-cap.ts`
- Test: `lib/guardrail/reputation-cap.test.ts`

**Interfaces:**
- Consumes: `GuardRailPolicy` from `./policy.ts`.
- Produces: `reputationScaledCap(policy: GuardRailPolicy, score: number): number` — the max USD a single payment may be, given the agent's 0–100 reputation score.

- [ ] **Step 1: Write the failing test** — `lib/guardrail/reputation-cap.test.ts`

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./reputation-cap.ts`.

- [ ] **Step 3: Implement `lib/guardrail/reputation-cap.ts`**

```ts
import type { GuardRailPolicy } from "./policy";

/**
 * Per-transaction spend cap (USD) scaled by an agent's 0–100 reputation:
 * baseCapUsd at score 0, rising linearly to maxCapUsd at score >= atScore.
 * Higher-trust agents are allowed larger single payments.
 */
export function reputationScaledCap(policy: GuardRailPolicy, score: number): number {
  const { baseCapUsd, maxCapUsd, atScore } = policy.reputationScaling;
  if (atScore <= 0) return maxCapUsd;
  const t = Math.max(0, Math.min(1, score / atScore));
  return baseCapUsd + (maxCapUsd - baseCapUsd) * t;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/guardrail/reputation-cap.ts lib/guardrail/reputation-cap.test.ts
git commit -m "feat(guardrail): reputation-scaled per-transaction cap"
```

---

### Task 3: Store-derived signal helpers (pure)

**Files:**
- Create: `lib/guardrail/signals.ts`
- Test: `lib/guardrail/signals.test.ts`

**Interfaces:**
- Consumes: `PaymentEvent` shape (subset: `{ payer, agentId, amountUsdc, ts }`).
- Produces:
  - `paymentKey(e: {payer: string|null; agentId: string|null}): string` — the identity a policy is scoped to (prefers `agentId`, falls back to lowercased `payer`).
  - `sumTodaysSpendUsd(events: PaymentRow[], key: string, now: Date): number`
  - `countRecent(events: PaymentRow[], key: string, windowMs: number, now: Date): number`
  - `type PaymentRow = { payer: string | null; agentId: string | null; amountUsdc: string; ts: string }`

- [ ] **Step 1: Write the failing test** — `lib/guardrail/signals.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { paymentKey, sumTodaysSpendUsd, countRecent, type PaymentRow } from "./signals";

const NOW = new Date("2026-06-17T12:00:00.000Z");
function row(over: Partial<PaymentRow>): PaymentRow {
  return { payer: "0xPAYER", agentId: "668408", amountUsdc: "0.003", ts: NOW.toISOString(), ...over };
}

describe("paymentKey", () => {
  it("prefers agentId", () => {
    expect(paymentKey({ payer: "0xAbC", agentId: "42" })).toBe("agent:42");
  });
  it("falls back to lowercased payer when no agentId", () => {
    expect(paymentKey({ payer: "0xAbC", agentId: null })).toBe("addr:0xabc");
  });
});

describe("sumTodaysSpendUsd", () => {
  it("sums only this key's payments dated today (UTC)", () => {
    const events: PaymentRow[] = [
      row({ amountUsdc: "0.003" }),
      row({ amountUsdc: "0.005" }),
      row({ agentId: "999", amountUsdc: "1.00" }), // different key
      row({ amountUsdc: "0.01", ts: "2026-06-16T23:59:59.000Z" }), // yesterday UTC
    ];
    expect(sumTodaysSpendUsd(events, "agent:668408", NOW)).toBeCloseTo(0.008, 6);
  });
});

describe("countRecent", () => {
  it("counts only this key's payments within windowMs of now", () => {
    const events: PaymentRow[] = [
      row({ ts: new Date(NOW.getTime() - 1_000).toISOString() }),
      row({ ts: new Date(NOW.getTime() - 5_000).toISOString() }),
      row({ ts: new Date(NOW.getTime() - 20_000).toISOString() }), // outside 10s window
      row({ agentId: "999", ts: NOW.toISOString() }), // different key
    ];
    expect(countRecent(events, "agent:668408", 10_000, NOW)).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./signals.ts`.

- [ ] **Step 3: Implement `lib/guardrail/signals.ts`**

```ts
export type PaymentRow = {
  payer: string | null;
  agentId: string | null;
  amountUsdc: string;
  ts: string;
};

/** Identity a GuardRail policy is scoped to: the verified agent id if present, else the payer address. */
export function paymentKey(e: { payer: string | null; agentId: string | null }): string {
  if (e.agentId) return `agent:${e.agentId}`;
  return `addr:${(e.payer ?? "unknown").toLowerCase()}`;
}

function sameUtcDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

export function sumTodaysSpendUsd(events: PaymentRow[], key: string, now: Date): number {
  let total = 0;
  for (const e of events) {
    if (paymentKey(e) !== key) continue;
    if (!sameUtcDay(new Date(e.ts), now)) continue;
    total += parseFloat(e.amountUsdc || "0");
  }
  return total;
}

export function countRecent(events: PaymentRow[], key: string, windowMs: number, now: Date): number {
  const cutoff = now.getTime() - windowMs;
  let n = 0;
  for (const e of events) {
    if (paymentKey(e) !== key) continue;
    if (new Date(e.ts).getTime() >= cutoff) n++;
  }
  return n;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/guardrail/signals.ts lib/guardrail/signals.test.ts
git commit -m "feat(guardrail): store-derived daily-spend and velocity signals"
```

---

### Task 4: Decision engine + HTTP mapping (pure)

**Files:**
- Create: `lib/guardrail/engine.ts`
- Test: `lib/guardrail/engine.test.ts`

**Interfaces:**
- Consumes: `GuardRailPolicy`, `reputationScaledCap`.
- Produces:
  - `interface GuardRailContext { agentId: string|null; agentAddress: string|null; payer: string|null; merchantId: string; endpoint: string; amountUsdc: number; }`
  - `interface GuardRailSignals { reputationScore: number; todaysSpendUsd: number; recentCount: number; }`
  - `interface GuardRailDecision { decision: "allow"|"deny"|"escalate"; reason: string; appliedTier: string; remainingDaily: number; }`
  - `evaluate(policy: GuardRailPolicy, ctx: GuardRailContext, signals: GuardRailSignals): GuardRailDecision`
  - `guardrailResponseFor(d: GuardRailDecision, endpoint: string): { status: number; body: Record<string, unknown> } | null` — `null` means "allow, continue"; non-null is the HTTP block response.

**Decision order (first match wins, matches the code below):** disabled → allow; not on allowlist → deny; **amount > approval threshold → escalate**; **amount > reputation cap → deny** (reached only for amounts already within the approval threshold, since larger amounts escalate first — so this is equivalent to "over cap AND ≤ threshold"); daily cap exceeded → deny; velocity exceeded → deny; else allow. `remainingDaily = max(0, dailyCapUsd − todaysSpendUsd)` on every decision. The escalate-before-cap order is intentional: a large payment from a low-reputation agent must reach a human, not be silently denied.

- [ ] **Step 1: Write the failing test** — `lib/guardrail/engine.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { evaluate, guardrailResponseFor, type GuardRailContext, type GuardRailSignals } from "./engine";
import { DEFAULT_POLICY } from "./policy";

const policy = {
  ...DEFAULT_POLICY,
  merchantId: "press",
  enabled: true,
  allowlist: [],
  dailyCapUsd: 1.0,
  velocity: { maxCount: 3, windowMs: 10_000 },
  reputationScaling: { baseCapUsd: 0.01, maxCapUsd: 0.1, atScore: 80 },
  humanApprovalThresholdUsd: 0.25,
};
const ctx = (over: Partial<GuardRailContext> = {}): GuardRailContext => ({
  agentId: "668408", agentAddress: "0xAA", payer: "0xAA",
  merchantId: "press", endpoint: "/api/article/1", amountUsdc: 0.003, ...over,
});
const sig = (over: Partial<GuardRailSignals> = {}): GuardRailSignals => ({
  reputationScore: 80, todaysSpendUsd: 0, recentCount: 0, ...over,
});

describe("evaluate", () => {
  it("allows a normal in-policy payment", () => {
    const d = evaluate(policy, ctx(), sig());
    expect(d.decision).toBe("allow");
    expect(d.remainingDaily).toBeCloseTo(1.0, 6);
  });
  it("allows everything when the policy is disabled", () => {
    expect(evaluate({ ...policy, enabled: false }, ctx({ amountUsdc: 999 }), sig({ reputationScore: 0 })).decision).toBe("allow");
  });
  it("denies a payer not on a non-empty allowlist", () => {
    const d = evaluate({ ...policy, allowlist: ["0xbb"] }, ctx({ payer: "0xAA", agentId: null }), sig());
    expect(d.decision).toBe("deny");
    expect(d.reason).toMatch(/allowlist/i);
  });
  it("denies a payment above the reputation cap (low score) but below approval threshold", () => {
    // score 0 -> cap 0.01; amount 0.05 > cap, and 0.05 <= 0.25 threshold
    const d = evaluate(policy, ctx({ amountUsdc: 0.05 }), sig({ reputationScore: 0 }));
    expect(d.decision).toBe("deny");
    expect(d.reason).toMatch(/cap/i);
  });
  it("escalates a payment above the human-approval threshold", () => {
    const d = evaluate(policy, ctx({ amountUsdc: 0.5 }), sig({ reputationScore: 100 }));
    expect(d.decision).toBe("escalate");
  });
  it("denies when the daily cap is already spent", () => {
    const d = evaluate(policy, ctx({ amountUsdc: 0.003 }), sig({ todaysSpendUsd: 1.0 }));
    expect(d.decision).toBe("deny");
    expect(d.reason).toMatch(/daily/i);
    expect(d.remainingDaily).toBe(0);
  });
  it("denies when velocity is exceeded", () => {
    const d = evaluate(policy, ctx(), sig({ recentCount: 3 }));
    expect(d.decision).toBe("deny");
    expect(d.reason).toMatch(/velocity|rate/i);
  });
});

describe("guardrailResponseFor", () => {
  it("returns null for allow", () => {
    expect(guardrailResponseFor({ decision: "allow", reason: "ok", appliedTier: "t", remainingDaily: 1 }, "/x")).toBeNull();
  });
  it("returns 403 for deny", () => {
    const r = guardrailResponseFor({ decision: "deny", reason: "over cap", appliedTier: "t", remainingDaily: 1 }, "/x");
    expect(r?.status).toBe(403);
    expect(r?.body.error).toMatch(/guardrail/i);
  });
  it("returns 202 for escalate", () => {
    const r = guardrailResponseFor({ decision: "escalate", reason: "needs approval", appliedTier: "t", remainingDaily: 1 }, "/x");
    expect(r?.status).toBe(202);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./engine.ts`.

- [ ] **Step 3: Implement `lib/guardrail/engine.ts`**

```ts
import type { GuardRailPolicy } from "./policy";
import { reputationScaledCap } from "./reputation-cap";

export interface GuardRailContext {
  agentId: string | null;
  agentAddress: string | null;
  payer: string | null;
  merchantId: string;
  endpoint: string;
  amountUsdc: number;
}

export interface GuardRailSignals {
  reputationScore: number;
  todaysSpendUsd: number;
  recentCount: number;
}

export interface GuardRailDecision {
  decision: "allow" | "deny" | "escalate";
  reason: string;
  appliedTier: string;
  remainingDaily: number;
}

export function evaluate(
  policy: GuardRailPolicy,
  ctx: GuardRailContext,
  signals: GuardRailSignals,
): GuardRailDecision {
  const remainingDaily = Math.max(0, policy.dailyCapUsd - signals.todaysSpendUsd);
  const cap = reputationScaledCap(policy, signals.reputationScore);
  const appliedTier = `rep ${signals.reputationScore} → cap $${cap.toFixed(4)} · daily left $${remainingDaily.toFixed(4)}`;
  const base = { appliedTier, remainingDaily };

  if (!policy.enabled) return { decision: "allow", reason: "guardrail disabled", ...base };

  if (policy.allowlist.length > 0) {
    const payer = (ctx.payer ?? "").toLowerCase();
    if (!policy.allowlist.map((a) => a.toLowerCase()).includes(payer)) {
      return { decision: "deny", reason: `payer not on allowlist`, ...base };
    }
  }

  if (ctx.amountUsdc > policy.humanApprovalThresholdUsd) {
    return { decision: "escalate", reason: `amount $${ctx.amountUsdc} over approval threshold $${policy.humanApprovalThresholdUsd}`, ...base };
  }

  if (ctx.amountUsdc > cap) {
    return { decision: "deny", reason: `amount $${ctx.amountUsdc} over reputation cap $${cap.toFixed(4)}`, ...base };
  }

  if (signals.todaysSpendUsd + ctx.amountUsdc > policy.dailyCapUsd) {
    return { decision: "deny", reason: `daily cap $${policy.dailyCapUsd} exceeded`, ...base, remainingDaily: 0 };
  }

  if (signals.recentCount >= policy.velocity.maxCount) {
    return { decision: "deny", reason: `velocity limit ${policy.velocity.maxCount}/${policy.velocity.windowMs}ms exceeded`, ...base };
  }

  return { decision: "allow", reason: "within policy", ...base };
}

export function guardrailResponseFor(
  d: GuardRailDecision,
  endpoint: string,
): { status: number; body: Record<string, unknown> } | null {
  if (d.decision === "allow") return null;
  if (d.decision === "escalate") {
    return {
      status: 202,
      body: { status: "pending_approval", error: "GuardRail: payment escalated for human approval", endpoint, reason: d.reason },
    };
  }
  return {
    status: 403,
    body: { error: "GuardRail blocked this payment", endpoint, reason: d.reason, appliedTier: d.appliedTier, remainingDaily: d.remainingDaily },
  };
}
```

Note: the escalate check precedes the cap check so a large payment from a low-rep agent escalates rather than being silently denied (the test `escalates a payment above the human-approval threshold` uses score 100; the `deny over cap` test uses amount 0.05 ≤ threshold 0.25 so it reaches the cap check).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS (all engine + earlier tests green).

- [ ] **Step 5: Commit**

```bash
git add lib/guardrail/engine.ts lib/guardrail/engine.test.ts
git commit -m "feat(guardrail): pure decision engine and HTTP response mapping"
```

---

### Task 5: Persistent approval queue

**Files:**
- Create: `lib/guardrail/approvals.ts`
- Test: `lib/guardrail/approvals.test.ts`

**Interfaces:**
- Produces:
  - `interface Approval { id: string; endpoint: string; agentId: string|null; payer: string|null; amountUsdc: number; reason: string; status: "pending"|"approved"|"denied"; createdAt: string; resolvedAt: string|null; }`
  - `enqueueApproval(input: Omit<Approval,"id"|"status"|"createdAt"|"resolvedAt">): Promise<Approval>`
  - `listPending(): Promise<Approval[]>`
  - `getApproval(id: string): Promise<Approval | null>`
  - `resolveApproval(id: string, approve: boolean): Promise<Approval | null>`

- [ ] **Step 1: Write the failing test** — `lib/guardrail/approvals.test.ts`

```ts
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./approvals.ts`.

- [ ] **Step 3: Implement `lib/guardrail/approvals.ts`**

```ts
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
    row.status = approve ? "approved" : "denied";
    row.resolvedAt = new Date().toISOString();
    await writeAll(rows);
    return row;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/guardrail/approvals.ts lib/guardrail/approvals.test.ts
git commit -m "feat(guardrail): persistent human-approval queue"
```

---

### Task 6: Async gate (signal-gathering wiring)

**Files:**
- Create: `lib/guardrail/gate.ts`
- Test: `lib/guardrail/gate.test.ts`

**Interfaces:**
- Consumes: `loadPolicy`, `evaluate`, `sumTodaysSpendUsd`, `countRecent`, `paymentKey`; and at runtime `@/lib/reputation#getReputation`, `@/lib/store#listPayments`.
- Produces: `guardrailGate(ctx: GuardRailContext): Promise<GuardRailDecision>`.

This file uses the `@/` alias (runtime module). The test mocks the two `@/` deps via `vi.mock`.

- [ ] **Step 1: Write the failing test** — `lib/guardrail/gate.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/reputation", () => ({ getReputation: vi.fn() }));
vi.mock("@/lib/store", () => ({ listPayments: vi.fn() }));
vi.mock("./policy", async (orig) => {
  const real = await orig<typeof import("./policy")>();
  return { ...real, loadPolicy: vi.fn() };
});

import { getReputation } from "@/lib/reputation";
import { listPayments } from "@/lib/store";
import { loadPolicy, DEFAULT_POLICY } from "./policy";
import { guardrailGate } from "./gate";

const enabled = { ...DEFAULT_POLICY, merchantId: "press", enabled: true, dailyCapUsd: 1, humanApprovalThresholdUsd: 0.25, reputationScaling: { baseCapUsd: 0.01, maxCapUsd: 0.1, atScore: 80 } };
const ctx = { agentId: "668408", agentAddress: "0xAA", payer: "0xAA", merchantId: "press", endpoint: "/api/article/1", amountUsdc: 0.003 };

beforeEach(() => { vi.clearAllMocks(); });

describe("guardrailGate", () => {
  it("allows when policy disabled without reading reputation", async () => {
    (loadPolicy as any).mockResolvedValue({ ...enabled, enabled: false });
    const d = await guardrailGate(ctx);
    expect(d.decision).toBe("allow");
    expect(getReputation).not.toHaveBeenCalled();
  });

  it("gathers reputation + spend and allows an in-policy payment", async () => {
    (loadPolicy as any).mockResolvedValue(enabled);
    (getReputation as any).mockResolvedValue({ agentId: "668408", count: 3, score: 80 });
    (listPayments as any).mockResolvedValue([]);
    const d = await guardrailGate(ctx);
    expect(d.decision).toBe("allow");
  });

  it("denies when today's spend (from the store) exhausts the daily cap", async () => {
    (loadPolicy as any).mockResolvedValue(enabled);
    (getReputation as any).mockResolvedValue({ agentId: "668408", count: 3, score: 80 });
    (listPayments as any).mockResolvedValue([
      { payer: "0xAA", agentId: "668408", amountUsdc: "1.0", ts: new Date().toISOString() },
    ]);
    const d = await guardrailGate(ctx);
    expect(d.decision).toBe("deny");
    expect(d.reason).toMatch(/daily/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./gate.ts`.

- [ ] **Step 3: Implement `lib/guardrail/gate.ts`**

```ts
import { getReputation } from "@/lib/reputation";
import { listPayments } from "@/lib/store";
import { loadPolicy } from "./policy";
import { evaluate, type GuardRailContext, type GuardRailDecision } from "./engine";
import { paymentKey, sumTodaysSpendUsd, countRecent } from "./signals";

/**
 * Gathers the three signals the pure engine needs (reputation score, today's
 * spend, recent payment count) from existing stores, then evaluates the policy.
 * Returns an `allow` decision immediately if the merchant has no enabled policy.
 */
export async function guardrailGate(ctx: GuardRailContext): Promise<GuardRailDecision> {
  const policy = await loadPolicy(ctx.merchantId);
  if (!policy.enabled) {
    return { decision: "allow", reason: "guardrail disabled", appliedTier: "n/a", remainingDaily: policy.dailyCapUsd };
  }

  const now = new Date();
  const score = (await getReputation(ctx.agentId)).score;
  const payments = await listPayments(1000);
  const key = paymentKey({ payer: ctx.payer, agentId: ctx.agentId });

  return evaluate(policy, ctx, {
    reputationScore: score,
    todaysSpendUsd: sumTodaysSpendUsd(payments, key, now),
    recentCount: countRecent(payments, key, policy.velocity.windowMs, now),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/guardrail/gate.ts lib/guardrail/gate.test.ts
git commit -m "feat(guardrail): async gate that gathers signals and evaluates policy"
```

---

### Task 7: Interpose GuardRail in the paywall + extend PaymentEvent

**Files:**
- Modify: `lib/store.ts` (extend `PaymentEvent`)
- Modify: `lib/paywall.ts` (interposition + opts)
- Test: manual (facilitator hits the network) — verified by curl against `npm run dev`

**Interfaces:**
- Consumes: `guardrailGate`, `guardrailResponseFor`, `enqueueApproval`.
- Produces: extended `PaywallOpts.guardrail?: { merchantId: string }`; `PaymentEvent` gains optional `decision?`, `policyTier?`, `remainingDaily?`.

- [ ] **Step 1: Extend `PaymentEvent` in `lib/store.ts`**

Add three optional fields to the interface (after `agentAddress`):

```ts
  agentAddress: string | null;
  /** GuardRail decision recorded with the settled payment (optional; absent for ungoverned endpoints). */
  decision?: "allow" | "escalate";
  policyTier?: string;
  remainingDaily?: number;
  ts: string;
```

(They are optional, so every existing `recordPayment` call and every persisted event stays valid.)

- [ ] **Step 2: Add the GuardRail option and imports to `lib/paywall.ts`**

At the top, add imports:

```ts
import { guardrailGate } from "@/lib/guardrail/gate";
import { guardrailResponseFor } from "@/lib/guardrail/engine";
import { enqueueApproval } from "@/lib/guardrail/approvals";
```

Extend `PaywallOpts`:

```ts
export interface PaywallOpts {
  minScore?: number;
  discount?: { atScore: number; price: string };
  /** Enable GuardRail spend-policy enforcement for this endpoint, scoped to a merchant id. */
  guardrail?: { merchantId: string };
}
```

- [ ] **Step 3: Interpose the gate between verify and settle in `withPaywall`**

In the `try` block, **after** the `verifyResult.isValid` check passes and **before** `const settleResult = await facilitator.settle(...)`, insert:

```ts
      // --- GuardRail: evaluate spend policy before settling ---
      let grDecision: "allow" | "escalate" = "allow";
      let grTier: string | undefined;
      let grRemaining: number | undefined;
      if (opts.guardrail) {
        const amountUsd = Number(requirements.amount) / 1e6;
        const payerForGate = (verifyResult.payer ?? null) as string | null;
        const decision = await guardrailGate({
          agentId,
          agentAddress,
          payer: payerForGate,
          merchantId: opts.guardrail.merchantId,
          endpoint,
          amountUsdc: amountUsd,
        });
        const blocked = guardrailResponseFor(decision, endpoint);
        if (blocked) {
          if (decision.decision === "escalate") {
            await enqueueApproval({
              endpoint,
              agentId,
              payer: payerForGate,
              amountUsdc: amountUsd,
              reason: decision.reason,
            }).catch((e) => console.error("[guardrail] enqueue failed:", e));
          }
          console.log(`[guardrail] ${decision.decision} ${endpoint} — ${decision.reason}`);
          return NextResponse.json(blocked.body, { status: blocked.status });
        }
        grTier = decision.appliedTier;
        grRemaining = decision.remainingDaily;
      }
```

Then in the existing `recordPayment({ ... })` call, add the three fields:

```ts
      await recordPayment({
        endpoint,
        payer,
        amountUsdc,
        network: requirements.network,
        gatewayTx: settleResult.transaction ?? null,
        agentId,
        agentAddress,
        decision: opts.guardrail ? grDecision : undefined,
        policyTier: grTier,
        remainingDaily: grRemaining,
      }).catch((e) => console.error("[paywall] failed to record payment:", e));
```

(`grDecision` stays `"allow"` here because an `escalate`/`deny` returned early above and never reaches settlement.)

- [ ] **Step 4: Add a governed test endpoint** — create `app/api/premium/guarded/route.ts`

```ts
import { NextResponse } from "next/server";
import { withPaywall } from "@/lib/paywall";

export const POST = withPaywall(
  async () => NextResponse.json({ ok: true, secret: "guardrail demo payload" }),
  "$0.003",
  "/api/premium/guarded",
  { guardrail: { merchantId: "press" } },
);
```

- [ ] **Step 5: Verify the no-op path (no policy enabled) still returns a clean 402**

Run: `npm run dev` (in another shell), then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/premium/guarded
```

Expected: `402` (no policy enabled for "press" yet → gate is a no-op; paywall still demands payment). Also confirm an existing endpoint is unaffected:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/premium/summarize
```

Expected: `402`.

- [ ] **Step 6: Run the full unit suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS (all prior tests green).

- [ ] **Step 7: Commit**

```bash
git add lib/store.ts lib/paywall.ts app/api/premium/guarded/route.ts
git commit -m "feat(guardrail): interpose policy gate in withPaywall before settlement"
```

---

### Task 8: Admin API routes (policies, pending, approve)

**Files:**
- Create: `app/api/guardrail/policies/route.ts`
- Create: `app/api/guardrail/pending/route.ts`
- Create: `app/api/guardrail/approve/route.ts`
- Test: manual (curl against `npm run dev`)

**Interfaces:**
- Consumes: `loadPolicy`, `savePolicy`, `DEFAULT_POLICY`, `listPending`, `resolveApproval`.

- [ ] **Step 1: Create `app/api/guardrail/policies/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { loadPolicy, savePolicy, DEFAULT_POLICY, type GuardRailPolicy } from "@/lib/guardrail/policy";

export async function GET(req: NextRequest) {
  const merchantId = req.nextUrl.searchParams.get("merchantId") ?? "press";
  return NextResponse.json(await loadPolicy(merchantId));
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as Partial<GuardRailPolicy> & { merchantId?: string };
  const merchantId = body.merchantId ?? "press";
  const merged: GuardRailPolicy = { ...DEFAULT_POLICY, ...(await loadPolicy(merchantId)), ...body, merchantId };
  await savePolicy(merged);
  return NextResponse.json(merged);
}
```

- [ ] **Step 2: Create `app/api/guardrail/pending/route.ts`**

```ts
import { NextResponse } from "next/server";
import { listPending } from "@/lib/guardrail/approvals";

export async function GET() {
  return NextResponse.json(await listPending());
}
```

- [ ] **Step 3: Create `app/api/guardrail/approve/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { resolveApproval } from "@/lib/guardrail/approvals";

export async function POST(req: NextRequest) {
  const { id, approve } = (await req.json()) as { id: string; approve: boolean };
  const resolved = await resolveApproval(id, Boolean(approve));
  if (!resolved) return NextResponse.json({ error: "approval not found" }, { status: 404 });
  return NextResponse.json(resolved);
}
```

- [ ] **Step 4: Verify the policy round-trip via curl** (`npm run dev` running)

```bash
curl -s -X PUT http://localhost:3000/api/guardrail/policies \
  -H 'content-type: application/json' \
  -d '{"merchantId":"press","enabled":true,"dailyCapUsd":0.5,"humanApprovalThresholdUsd":0.25}' | head -c 400
echo
curl -s "http://localhost:3000/api/guardrail/policies?merchantId=press" | head -c 400
```

Expected: both responses show `"enabled":true` and `"dailyCapUsd":0.5`.

- [ ] **Step 5: Verify the escalate → pending → approve loop**

With the policy enabled (threshold `$0.25`) and the guarded endpoint priced `$0.003`, escalation needs a higher-priced governed endpoint; for a quick check, temporarily PUT `humanApprovalThresholdUsd` to `0.001` so the `$0.003` guarded endpoint escalates, then drive a payment with the buyer agent against `/api/premium/guarded` and confirm:

```bash
curl -s http://localhost:3000/api/guardrail/pending | head -c 400
```

Expected: a JSON array containing one pending approval for `/api/premium/guarded`. Then approve it:

```bash
ID=$(curl -s http://localhost:3000/api/guardrail/pending | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
curl -s -X POST http://localhost:3000/api/guardrail/approve -H 'content-type: application/json' -d "{\"id\":\"$ID\",\"approve\":true}" | head -c 300
curl -s http://localhost:3000/api/guardrail/pending   # should now be []
```

Restore `humanApprovalThresholdUsd` to `0.25` afterward.

- [ ] **Step 6: Commit**

```bash
git add app/api/guardrail
git commit -m "feat(guardrail): admin API for policies, pending approvals, and approve/deny"
```

---

### Task 9: GuardRail dashboard page

**Files:**
- Create: `app/guardrail/page.tsx`
- Test: manual (visual, via `npm run dev`)

**Interfaces:**
- Consumes: `GET/PUT /api/guardrail/policies`, `GET /api/guardrail/pending`, `POST /api/guardrail/approve`, `GET /api/payments` (existing, for the live allow feed).

- [ ] **Step 1: Create `app/guardrail/page.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";

type Policy = {
  merchantId: string; enabled: boolean; dailyCapUsd: number;
  humanApprovalThresholdUsd: number;
  reputationScaling: { baseCapUsd: number; maxCapUsd: number; atScore: number };
  velocity: { maxCount: number; windowMs: number };
};
type Approval = { id: string; endpoint: string; agentId: string | null; amountUsdc: number; reason: string; createdAt: string };
type Payment = { id: string; endpoint: string; amountUsdc: string; agentId: string | null; policyTier?: string; ts: string };

export default function GuardRailPage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [pending, setPending] = useState<Approval[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  async function refresh() {
    setPending(await (await fetch("/api/guardrail/pending")).json());
    const p: Payment[] = await (await fetch("/api/payments")).json().then((d) => d.payments ?? d).catch(() => []);
    setPayments(Array.isArray(p) ? p.slice(0, 15) : []);
  }
  useEffect(() => {
    fetch("/api/guardrail/policies?merchantId=press").then((r) => r.json()).then(setPolicy);
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  async function savePolicy(next: Policy) {
    setPolicy(next);
    await fetch("/api/guardrail/policies", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
  }
  async function decide(id: string, approve: boolean) {
    await fetch("/api/guardrail/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, approve }) });
    refresh();
  }

  return (
    <main style={{ maxWidth: 880, margin: "2rem auto", fontFamily: "ui-sans-serif, system-ui", padding: "0 1rem" }}>
      <h1>GuardRail — agent spend firewall</h1>
      {policy && (
        <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, margin: "16px 0" }}>
          <h2>Policy · {policy.merchantId}</h2>
          <label style={{ display: "block", margin: "8px 0" }}>
            <input type="checkbox" checked={policy.enabled} onChange={(e) => savePolicy({ ...policy, enabled: e.target.checked })} /> enabled
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            daily cap $<input type="number" step="0.01" value={policy.dailyCapUsd} onChange={(e) => savePolicy({ ...policy, dailyCapUsd: Number(e.target.value) })} />
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            human-approval threshold $<input type="number" step="0.01" value={policy.humanApprovalThresholdUsd} onChange={(e) => savePolicy({ ...policy, humanApprovalThresholdUsd: Number(e.target.value) })} />
          </label>
        </section>
      )}

      <section style={{ border: "1px solid #f0c", borderRadius: 12, padding: 16, margin: "16px 0" }}>
        <h2>Pending approvals ({pending.length})</h2>
        {pending.length === 0 && <p style={{ color: "#888" }}>none</p>}
        {pending.map((a) => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid #eee" }}>
            <span>{a.endpoint} · ${a.amountUsdc} · agent {a.agentId ?? "—"} · {a.reason}</span>
            <span>
              <button onClick={() => decide(a.id, true)}>approve</button>{" "}
              <button onClick={() => decide(a.id, false)}>deny</button>
            </span>
          </div>
        ))}
      </section>

      <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
        <h2>Recent settled (allowed) payments</h2>
        {payments.map((p) => (
          <div key={p.id} style={{ padding: "6px 0", borderTop: "1px solid #eee", fontSize: 14 }}>
            ✅ {p.endpoint} · ${p.amountUsdc} · agent {p.agentId ?? "—"} {p.policyTier ? `· ${p.policyTier}` : ""}
          </div>
        ))}
      </section>
    </main>
  );
}
```

(If `/api/payments` returns a bare array vs `{payments:[...]}`, the `refresh` handler already tolerates both.)

- [ ] **Step 2: Verify visually**

Run: `npm run dev`, open `http://localhost:3000/guardrail`.
Expected: policy card with an `enabled` toggle and editable caps; a "Pending approvals" section; a "Recent settled payments" feed that updates every 3s. Toggle `enabled`, reload, confirm it persisted (PUT worked).

- [ ] **Step 3: Commit**

```bash
git add app/guardrail/page.tsx
git commit -m "feat(guardrail): dashboard with policy editor, approval queue, live feed"
```

---

### Task 10: First deploy + end-to-end smoke

**Files:**
- Modify: `README.md` (add a short GuardRail section + live link) — optional, fold into the docs plan if preferred
- Test: manual (curl against the deployed URL)

- [ ] **Step 1: Production build locally**

Run: `npm run build`
Expected: build succeeds with no type errors. Fix any surfaced before deploying.

- [ ] **Step 2: Deploy to Vercel**

Run: `npx vercel --prod` (first run links/creates the project; set env vars `SELLER_ADDRESS` and any `BUYER_*`/RPC vars from `.env.local` in the Vercel dashboard).
Expected: a live `https://<project>.vercel.app` URL.

> Note: `.data/*.json` is ephemeral on Vercel's serverless filesystem (resets between cold starts). For the hackathon demo this is acceptable (the fleet runs against a warm instance and the demo is recorded in one session). If persistence becomes a problem, the documented upgrade is swapping the JSON stores for a hosted KV/Postgres — out of scope for this plan.

- [ ] **Step 3: Smoke-test the deployed gate**

```bash
BASE=https://<project>.vercel.app
curl -s "$BASE/api/guardrail/policies?merchantId=press" | head -c 300          # policy reads
curl -s -X PUT "$BASE/api/guardrail/policies" -H 'content-type: application/json' -d '{"merchantId":"press","enabled":true}' | head -c 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/premium/guarded"   # expect 402
```

Expected: policy reads/writes work; guarded endpoint returns `402`. Open `$BASE/guardrail` and confirm the dashboard renders.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "chore(guardrail): first Vercel deploy + smoke notes"
git push origin main
```

---

## Self-Review (completed by author)

**Spec coverage (vs `2026-06-17-presspay-design.md` §4 Component 1 + §6/§8 D1–D4):**
- Policy object generalizing `--limit` → Task 1 (`GuardRailPolicy`). ✓
- Per-merchant allowlist → engine (Task 4). ✓
- Velocity/sliding-window → store-derived `countRecent` (Task 3) + engine (Task 4). ✓
- Reputation-scaled limits reusing `reputation.ts` → Task 2 + gate (Task 6). ✓
- Human-in-loop approval (pause settle until approve) → escalate path returns before `settle` (Task 7) + approval queue (Task 5) + approve API (Task 8) + dashboard (Task 9). ✓
- `paywall.ts` ~15-line interposition between verify and settle, default no-op → Task 7. ✓
- `PaymentEvent` extended (`decision`, `policyTier`, `remainingDaily`) → Task 7. ✓
- `circle wallet limit` as documented floor → noted as out-of-scope-for-enforcement here (mainnet-only per spec §10 risk); GuardRail enforces independently. Documentation of the floor belongs to the README/docs plan. ✓ (intentional deferral)
- First deploy by D4 → Task 10. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code; verification steps show exact curl commands + expected output. ✓

**Type consistency:** `GuardRailPolicy`/`GuardRailContext`/`GuardRailSignals`/`GuardRailDecision` names and fields are identical across Tasks 1/4/6/7; `guardrailGate` and `guardrailResponseFor` signatures match their call sites in Task 7; `evaluate` arg order `(policy, ctx, signals)` is consistent in Tasks 4 and 6. ✓

**Deferred to later plans (not gaps):** Circle CLI / Agent Wallet bootstrap + Skills/MCP (fleet plan); `CIRCLE-FEEDBACK.md` + README Circle-stack framing (docs plan); cache-TTL coherency fix between `reputation.ts` (30s) and `agentauth.ts` (60s) — add `clearReputationCache` on feedback writes when the give-feedback path is touched. These are tracked in the spec §10 and will appear in Plans 2–3.
