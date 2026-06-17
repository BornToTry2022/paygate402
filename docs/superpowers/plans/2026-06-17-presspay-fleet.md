# PressPay Front + Research-Agent Fleet — Implementation Plan (PressPay — Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the human-facing PressPay publication (a pay-per-article + tip site on Arc) and the autonomous research-agent fleet that monetizes it: each agent lists articles, reads the publisher's AgentScore (KYA), asks its own GuardRail-style policy buy/skip/escalate, and pays sub-cent USDC for what it chooses — producing real on-chain traction. Plus a traction-reporting script.

**Architecture:** Articles live in a leaf module (`lib/articles.ts`) with public blurbs and paywalled bodies. A free `/api/articles` lists them; a paywalled `/api/article/[id]` (price per article via the existing `withPaywall`) serves the body; `/api/tip` accepts a buyer-chosen tip. The `/press` pages render the publication + live earnings (from the existing payment store). The fleet's decision is a pure function (`lib/fleet/decide.ts`); `agent/research-agent.mts` wraps it around the proven `agent/buyer.mts` Gateway payment primitives and supports `--dry-run` (decide + print, no network). `scripts/traction.mts` summarizes on-chain traction and best-effort feeds `arc-canteen`.

**Tech Stack:** TypeScript (ESM), Next.js 16, React 19, viem, `@circle-fin/x402-batching`, vitest. The `.mts` scripts run via `node --experimental-transform-types` (NOT part of `next build`).

## Global Constraints

- **Two import-extension regimes (critical):**
  - Files compiled by **Next/vitest** (everything under `app/`, `lib/` consumed by them, test files): relative imports are **extensionless** (`./decide`, NOT `./decide.ts`). The `@/` alias is allowed only in `app/` routes/pages and Next-runtime `lib` files.
  - Files run by **node** (`agent/*.mts`, `scripts/*.mts`): relative imports to `lib` MUST carry the **`.ts` extension** (e.g. `import { decideBuy } from "../lib/fleet/decide.ts"`) — node's type-stripping requires it. This mirrors how `agent/buyer.mts` / `scripts/run-job.mts` already import `../lib/*.ts`.
  - **Therefore any `lib` module imported by BOTH a `.mts` script and Next must be a leaf with NO internal imports** (so it resolves identically in both), exactly like `lib/jobs.ts`. `lib/articles.ts` and `lib/fleet/decide.ts` MUST be import-free leaves.
- **Pure cores are synchronous, no I/O, no `Date.now()`** — `lib/fleet/decide.ts` is pure; `lib/articles.ts` is an in-memory seed (the publication's content) with pure accessors.
- **`tsc --noEmit` ground truth:** an editor "cannot find module" on a new extensionless import is a stale-LSP artifact; `npx tsc --noEmit` must report 0 errors. (`agent/**` and `scripts/**` are excluded from tsconfig, so `.mts` files are NOT typechecked by `tsc`/`next build` — verify them by running with `--dry-run`.)
- **Money:** prices are dollars as `number` in `lib`/fleet (e.g. `0.003`); the paywall takes a `"$0.003"` string.
- **Reuse verbatim:** `withPaywall(handler, price, endpoint, opts?)` (build per-request for dynamic prices); `listPayments(limit)` / `getStats()` (earnings, filter by `endpoint`); the `runtime="nodejs"` + `dynamic="force-dynamic"` route pattern; `agent/buyer.mts`'s `GatewayClient` (`gateway.deposit`, balance checks), `getAgentHeaders()`, `checkAndRedeposit()`, `--limit` argv parsing.
- **Frequent commits:** one per task, prefix `feat(press):` / `feat(fleet):` / `test(...)`. Never stage the repo's pre-existing uncommitted `README.md`.

## File Structure

**New (leaf logic — unit-tested, NO imports):**
- `lib/articles.ts` — `Article`, `PUBLISHER_AGENT_ID`, `listArticles`, `getArticleMeta`, `getArticleBody` (+ inline seed).
- `lib/fleet/decide.ts` — `FleetPolicy`, `BuyContext`, `BuyDecision`, `decideBuy`.

**New (Next-runtime):**
- `app/api/articles/route.ts` — free `GET` → `listArticles()`.
- `app/api/article/[id]/route.ts` — paywalled `GET` (per-article price) → article body.
- `app/api/tip/route.ts` — paywalled `GET` (buyer-chosen amount) → tip receipt.
- `app/press/page.tsx` — publication: article list + live earnings.
- `app/press/article/[id]/page.tsx` — single article (blurb + unlock count + agent-payable note).

**New (node `.mts` — verified by `--dry-run`/run, not tsc):**
- `agent/research-agent.mts` — the fleet decision loop (reuses buyer.mts primitives + `decideBuy`).
- `scripts/traction.mts` — traction summary + best-effort `arc-canteen` push.

**Modified:** `package.json` — add `"research-agent"` and `"traction"` npm scripts.

## Out of scope (YAGNI / user-side / deferred)

- **Browser-wallet human unlock/tip** (Privy/Dynamic embedded wallets) — not wired; the `/press` pages are a readable showcase + earnings, and the *agents* generate the payments. Human tipping via a real wallet is deferred.
- **Circle Agent Wallet bootstrap** (`scripts/circle-agent-wallet.mts`) — needs interactive `circle wallet login` (user auth). Per the spec's hybrid decision, the fleet runs on the proven ephemeral-wallet+Gateway path; the one real Agent-Wallet demo tx is a documented user step.
- **Live fleet run + real traction accrual + `arc-canteen` push** — needs funded testnet wallets + the ARC-cli installed (user actions). This plan delivers and `--dry-run`-verifies the code; the live run is the user's to trigger.
- **Per-merchant signal isolation** (the GuardRail deferred item) — single-publisher demo, not needed.

---

### Task 1: Article store + seed (pure leaf)

**Files:**
- Create: `lib/articles.ts`
- Test: `lib/articles.test.ts`

**Interfaces:**
- Produces: `interface Article { id: string; title: string; blurb: string; priceUsd: number; publisherAgentId: string }`; `const PUBLISHER_AGENT_ID: string`; `listArticles(): Article[]`; `getArticleMeta(id: string): Article | null`; `getArticleBody(id: string): string | null`.

- [ ] **Step 1: Write the failing test** — `lib/articles.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { listArticles, getArticleMeta, getArticleBody, PUBLISHER_AGENT_ID } from "./articles";

describe("articles", () => {
  it("lists at least 6 articles as metadata WITHOUT the body", () => {
    const list = listArticles();
    expect(list.length).toBeGreaterThanOrEqual(6);
    for (const a of list) {
      expect(a).toHaveProperty("id");
      expect(a).toHaveProperty("title");
      expect(a).toHaveProperty("blurb");
      expect(typeof a.priceUsd).toBe("number");
      expect(a.priceUsd).toBeGreaterThan(0);
      expect(a.publisherAgentId).toBe(PUBLISHER_AGENT_ID);
      expect(a).not.toHaveProperty("body"); // body is paywalled, never in the list
    }
  });
  it("ids are unique", () => {
    const ids = listArticles().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("getArticleMeta returns the article (no body) for a valid id, null otherwise", () => {
    const id = listArticles()[0].id;
    expect(getArticleMeta(id)?.id).toBe(id);
    expect(getArticleMeta(id)).not.toHaveProperty("body");
    expect(getArticleMeta("nope")).toBeNull();
  });
  it("getArticleBody returns a non-empty body for a valid id, null otherwise", () => {
    const id = listArticles()[0].id;
    expect((getArticleBody(id) ?? "").length).toBeGreaterThan(0);
    expect(getArticleBody("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./articles`.

- [ ] **Step 3: Implement `lib/articles.ts`** (import-free leaf — resolves in both Next and node)

```ts
/**
 * PressPay's publication content. A leaf module (NO imports) so it resolves
 * identically under the Next bundler (`@/lib/articles`) AND node's type-stripping
 * when `agent/research-agent.mts` imports it (`../lib/articles.ts`).
 *
 * Each article has a public `blurb` (shown free) and a paywalled `body` (served
 * only after an x402 payment via /api/article/[id]). The publisher is a single
 * ERC-8004 agent identity; override it with PUBLISHER_AGENT_ID in the env.
 */

export const PUBLISHER_AGENT_ID: string =
  (typeof process !== "undefined" && process.env?.PUBLISHER_AGENT_ID) || "668408";

export interface Article {
  id: string;
  title: string;
  blurb: string;
  priceUsd: number;
  publisherAgentId: string;
}

interface FullArticle extends Article {
  body: string;
}

const SEED: Omit<FullArticle, "publisherAgentId">[] = [
  {
    id: "arc-native-gas",
    title: "Why USDC-as-gas changes the math for agent payments",
    blurb: "On Arc, USDC is the native gas token. Here's why that single fact makes sub-cent agent payments actually pencil out.",
    priceUsd: 0.003,
    body: "When gas is paid in a volatile token, a $0.001 charge can cost more to settle than it collects. Arc makes USDC the native gas token, so a payment and its fee are denominated in the same dollar-stable unit. Combined with Gateway batching — which amortizes settlement across thousands of off-chain authorizations — the economics of nanopayments finally close. This is the precondition for an agent that pays per API call, per paragraph, or per second.",
  },
  {
    id: "x402-in-one-page",
    title: "x402 in one page: how an agent pays for a 402",
    blurb: "The HTTP 402 handshake, end to end: challenge, sign, retry, settle — with no accounts and no API keys.",
    priceUsd: 0.002,
    body: "An unpaid request returns HTTP 402 with a PAYMENT-REQUIRED challenge. The client signs an EIP-3009 authorization over the requirements and retries with a payment-signature header. The server verifies and settles via the facilitator, then serves the resource. Payment is identity: the settled authorization proves who paid, with no account to create and no key to leak.",
  },
  {
    id: "erc8004-reputation",
    title: "ERC-8004: giving agents an on-chain identity and reputation",
    blurb: "How a registry of agent identities + feedback turns 'some bot' into a counterparty you can price.",
    priceUsd: 0.004,
    body: "ERC-8004 mints an agent identity as an NFT and records feedback against it in a ReputationRegistry. A seller can read an agent's aggregate score and gate or discount access by it. The catch: most minted identities are inactive, so raw reputation is noisy — which is exactly why a derived trust score (see AgentScore) matters.",
  },
  {
    id: "erc8183-escrow",
    title: "ERC-8183 escrow: agents hiring agents, safely",
    blurb: "Created → Funded → Submitted → Completed → Rated. The escrow lifecycle that lets one agent pay another for work.",
    priceUsd: 0.004,
    body: "Agentic commerce needs more than pay-per-call: agents must hire other agents for multi-step work. ERC-8183 escrows a job's budget on-chain and releases it on completion, with a rating that feeds reputation. The open question reviewers flagged: disputes. A no-refund, one-shot escrow is fine until the deliverable is wrong.",
  },
  {
    id: "gateway-batching",
    title: "Gateway batching: how thousands of sub-cent payments become one settlement",
    blurb: "The trick that makes $0.000001 economically real — amortizing gas across a batch.",
    priceUsd: 0.003,
    body: "Circle Gateway collects many off-chain EIP-3009 authorizations and settles them as a single on-chain transaction. The per-payment cost is the batch's gas divided across all the authorizations in it — which is how a $0.000001 charge stops being absurd. The GatewayWalletBatched x402 scheme is what the buyer signs against.",
  },
  {
    id: "agent-spend-control",
    title: "The unsolved layer: controlling what an autonomous agent spends",
    blurb: "Settlement is solved. Authorization isn't. Why spend firewalls and KYA scoring are where the value moved.",
    priceUsd: 0.005,
    body: "Once an agent can pay autonomously, the hard problem is governing it: per-merchant allowlists, daily caps, velocity limits, human-in-the-loop approvals, and knowing whether the counterparty is trustworthy. The rail is a commodity; the trust-and-control layer on top of it is not. This is where GuardRail and AgentScore live.",
  },
];

const FULL: FullArticle[] = SEED.map((a) => ({ ...a, publisherAgentId: PUBLISHER_AGENT_ID }));

function strip(a: FullArticle): Article {
  const { body: _body, ...meta } = a;
  return meta;
}

export function listArticles(): Article[] {
  return FULL.map(strip);
}

export function getArticleMeta(id: string): Article | null {
  const a = FULL.find((x) => x.id === id);
  return a ? strip(a) : null;
}

export function getArticleBody(id: string): string | null {
  return FULL.find((x) => x.id === id)?.body ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/articles.ts lib/articles.test.ts
git commit -m "feat(press): article store with public blurbs and paywalled bodies"
```

---

### Task 2: Article + tip API routes

**Files:**
- Create: `app/api/articles/route.ts` (free list)
- Create: `app/api/article/[id]/route.ts` (paywalled body)
- Create: `app/api/tip/route.ts` (paywalled tip)
- Test: manual (curl against `npm run dev`)

**Interfaces:**
- Consumes: `listArticles`, `getArticleMeta`, `getArticleBody` (`@/lib/articles`); `withPaywall` (`@/lib/paywall`).

- [ ] **Step 1: Create `app/api/articles/route.ts`** (free)

```ts
import { NextResponse } from "next/server";
import { listArticles } from "@/lib/articles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Free article catalogue (metadata + price, no bodies) — what the fleet reads to decide. */
export async function GET() {
  return NextResponse.json({ articles: listArticles() });
}
```

- [ ] **Step 2: Create `app/api/article/[id]/route.ts`** (paywalled, per-article price)

```ts
import { NextRequest, NextResponse } from "next/server";
import { getArticleMeta, getArticleBody } from "@/lib/articles";
import { withPaywall } from "@/lib/paywall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const meta = getArticleMeta(id);
  if (!meta) return NextResponse.json({ error: "no such article" }, { status: 404 });

  // Build the paywall at the article's own price, then run it for this request.
  const gated = withPaywall(
    async () => NextResponse.json({ id, title: meta.title, body: getArticleBody(id) }),
    `$${meta.priceUsd}`,
    `/api/article/${id}`,
  );
  return gated(req);
}
```

- [ ] **Step 3: Create `app/api/tip/route.ts`** (paywalled, buyer-chosen amount)

```ts
import { NextRequest, NextResponse } from "next/server";
import { withPaywall } from "@/lib/paywall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tip the creator any amount: GET /api/tip?amount=0.01 — paywalled at the requested amount. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const raw = Number(req.nextUrl.searchParams.get("amount"));
  const amount = Number.isFinite(raw) && raw > 0 && raw <= 100 ? Math.round(raw * 1e6) / 1e6 : 0.01;
  const gated = withPaywall(
    async () => NextResponse.json({ ok: true, tipped: amount }),
    `$${amount}`,
    `/api/tip`,
  );
  return gated(req);
}
```

- [ ] **Step 4: Verify via curl** (`npm run dev` running in the background)

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/articles            # 200
curl -s http://localhost:3000/api/articles | head -c 200                                # {"articles":[...]}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/article/arc-native-gas  # 402 (paywalled)
curl -s -D - -o /dev/null http://localhost:3000/api/article/arc-native-gas | grep -i "payment-required" | head -1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/article/nope          # 404
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/tip?amount=0.01"      # 402
```

Expected: `/api/articles` → 200 + `{articles:[…]}`; `/api/article/arc-native-gas` → 402 with a `PAYMENT-REQUIRED` header; unknown article → 404; `/api/tip` → 402. Kill the dev server when done.

- [ ] **Step 5: Confirm unit suite + types still green**

Run: `npm test` (all green) and `npx tsc --noEmit` (0 errors).

- [ ] **Step 6: Commit**

```bash
git add app/api/articles/route.ts app/api/article/[id]/route.ts app/api/tip/route.ts
git commit -m "feat(press): free article catalogue, paywalled article body, and tip endpoints"
```

---

### Task 3: PressPay publication pages + earnings

**Files:**
- Create: `app/press/page.tsx` (list + earnings)
- Create: `app/press/article/[id]/page.tsx` (single article)
- Test: manual (visual, via `npm run dev`)

**Interfaces:**
- Consumes: `GET /api/articles`, `GET /api/payments` (existing — for live earnings + per-article unlock counts).

- [ ] **Step 1: Create `app/press/page.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Article = { id: string; title: string; blurb: string; priceUsd: number; publisherAgentId: string };
type Payment = { endpoint: string; amountUsdc: string };

export default function PressHome() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    fetch("/api/articles").then((r) => r.json()).then((d) => setArticles(d.articles ?? [])).catch(() => {});
    async function refresh() {
      const d = await fetch("/api/payments").then((r) => r.json()).catch(() => ({ payments: [] }));
      setPayments(Array.isArray(d.payments) ? d.payments : []);
    }
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  const articlePayments = payments.filter((p) => p.endpoint.startsWith("/api/article/") || p.endpoint === "/api/tip");
  const totalEarned = articlePayments.reduce((s, p) => s + parseFloat(p.amountUsdc || "0"), 0);
  const unlocks = (id: string) => payments.filter((p) => p.endpoint === `/api/article/${id}`).length;

  return (
    <main style={{ maxWidth: 760, margin: "2rem auto", fontFamily: "ui-serif, Georgia, serif", padding: "0 1rem" }}>
      <header style={{ borderBottom: "2px solid #111", paddingBottom: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 34 }}>PressPay</h1>
        <p style={{ color: "#555", margin: "4px 0 0" }}>An agent-payable publication on Circle Arc — unlock a single piece for sub-cent USDC.</p>
        <div style={{ marginTop: 10, fontFamily: "ui-sans-serif, system-ui", fontSize: 14 }}>
          <strong>{totalEarned.toFixed(6)} USDC</strong> earned · <strong>{articlePayments.length}</strong> paid unlocks/tips
        </div>
      </header>
      {articles.map((a) => (
        <article key={a.id} style={{ marginBottom: 22 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 22 }}>
            <Link href={`/press/article/${a.id}`} style={{ color: "#111", textDecoration: "none" }}>{a.title}</Link>
          </h2>
          <p style={{ color: "#444", margin: "0 0 6px" }}>{a.blurb}</p>
          <div style={{ fontFamily: "ui-sans-serif, system-ui", fontSize: 13, color: "#777" }}>
            🔓 ${a.priceUsd} · {unlocks(a.id)} unlock{unlocks(a.id) === 1 ? "" : "s"}
          </div>
        </article>
      ))}
    </main>
  );
}
```

- [ ] **Step 2: Create `app/press/article/[id]/page.tsx`**

```tsx
"use client";
import { useEffect, useState, use } from "react";
import Link from "next/link";

type Article = { id: string; title: string; blurb: string; priceUsd: number; publisherAgentId: string };

export default function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [article, setArticle] = useState<Article | null>(null);
  const [unlocks, setUnlocks] = useState(0);

  useEffect(() => {
    fetch("/api/articles").then((r) => r.json())
      .then((d) => setArticle((d.articles ?? []).find((a: Article) => a.id === id) ?? null)).catch(() => {});
    fetch("/api/payments").then((r) => r.json())
      .then((d) => setUnlocks((Array.isArray(d.payments) ? d.payments : []).filter((p: { endpoint: string }) => p.endpoint === `/api/article/${id}`).length))
      .catch(() => {});
  }, [id]);

  if (!article) return <main style={{ maxWidth: 680, margin: "3rem auto", fontFamily: "ui-serif, Georgia, serif" }}><Link href="/press">← PressPay</Link><p>Loading…</p></main>;

  return (
    <main style={{ maxWidth: 680, margin: "2rem auto", fontFamily: "ui-serif, Georgia, serif", padding: "0 1rem" }}>
      <Link href="/press" style={{ fontFamily: "ui-sans-serif, system-ui", fontSize: 14 }}>← PressPay</Link>
      <h1 style={{ fontSize: 30, marginTop: 12 }}>{article.title}</h1>
      <p style={{ fontSize: 19, color: "#333" }}>{article.blurb}</p>
      <div style={{ border: "1px dashed #bbb", borderRadius: 10, padding: 18, marginTop: 18, fontFamily: "ui-sans-serif, system-ui", background: "#fafafa" }}>
        <div style={{ fontWeight: 600 }}>🔒 The rest of this piece is agent-payable for ${article.priceUsd} in USDC.</div>
        <div style={{ color: "#666", fontSize: 14, marginTop: 6 }}>
          An autonomous agent unlocks it with an x402 payment: <code>GET /api/article/{article.id}</code>. {unlocks} unlock{unlocks === 1 ? "" : "s"} so far.
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify visually** (`npm run dev`)

Open `http://localhost:3000/press` → publication with the masthead, an earnings line, and the 6 articles (each with price + unlock count). Click one → `/press/article/<id>` renders the blurb + the agent-payable card. Confirm via curl:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/press                       # 200
curl -s http://localhost:3000/press | grep -o "PressPay" | head -1                          # matches
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/press/article/arc-native-gas # 200
```

Kill the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add app/press/page.tsx app/press/article/[id]/page.tsx
git commit -m "feat(press): publication pages with live earnings and per-article unlock counts"
```

---

### Task 4: Fleet decision core (pure) + research-agent loop

**Files:**
- Create: `lib/fleet/decide.ts` (pure leaf)
- Test: `lib/fleet/decide.test.ts`
- Create: `agent/research-agent.mts`
- Modify: `package.json` (add `research-agent` script)

**Interfaces:**
- Produces (decide.ts): `interface FleetPolicy { minPublisherKya: number; perTxCapUsd: number; dailyBudgetUsd: number; approvalThresholdUsd: number }`; `interface BuyContext { articlePriceUsd: number; publisherKya: number; spentTodayUsd: number }`; `interface BuyDecision { action: "buy" | "skip" | "escalate"; reason: string }`; `decideBuy(ctx: BuyContext, policy: FleetPolicy): BuyDecision`.

- [ ] **Step 1: Write the failing test** — `lib/fleet/decide.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { decideBuy, type FleetPolicy, type BuyContext } from "./decide";

const policy: FleetPolicy = { minPublisherKya: 50, perTxCapUsd: 0.01, dailyBudgetUsd: 0.5, approvalThresholdUsd: 0.05 };
const ctx = (over: Partial<BuyContext> = {}): BuyContext => ({ articlePriceUsd: 0.003, publisherKya: 82, spentTodayUsd: 0, ...over });

describe("decideBuy", () => {
  it("buys a trusted-publisher, in-budget article", () => {
    expect(decideBuy(ctx(), policy).action).toBe("buy");
  });
  it("skips a low-trust publisher", () => {
    const d = decideBuy(ctx({ publisherKya: 31 }), policy);
    expect(d.action).toBe("skip");
    expect(d.reason).toMatch(/kya/i);
  });
  it("escalates a price over the approval threshold (even from a trusted publisher)", () => {
    const d = decideBuy(ctx({ articlePriceUsd: 0.08 }), policy);
    expect(d.action).toBe("escalate");
  });
  it("skips a price over the per-tx cap but under the approval threshold", () => {
    // cap 0.01 < price 0.02 < threshold 0.05 -> skip (not escalate)
    expect(decideBuy(ctx({ articlePriceUsd: 0.02 }), policy).action).toBe("skip");
  });
  it("skips when the purchase would exceed the daily budget", () => {
    const d = decideBuy(ctx({ spentTodayUsd: 0.499 }), policy);
    expect(d.action).toBe("skip");
    expect(d.reason).toMatch(/budget/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./decide`.

- [ ] **Step 3: Implement `lib/fleet/decide.ts`** (import-free leaf)

```ts
/**
 * The research agent's buy/skip/escalate decision — the autonomy core.
 * Pure and import-free so it resolves under both vitest (`./decide`) and node
 * (`../lib/fleet/decide.ts` from agent/research-agent.mts).
 *
 * Order mirrors GuardRail: trust gate first, then escalate-before-cap (a too-large
 * spend asks a human rather than being silently skipped), then budget.
 */

export interface FleetPolicy {
  /** Skip articles whose publisher's AgentScore KYA is below this. */
  minPublisherKya: number;
  /** Skip a single article priced above this (and at/below the approval threshold). */
  perTxCapUsd: number;
  /** Stop buying once today's spend would exceed this. */
  dailyBudgetUsd: number;
  /** Escalate (ask a human) for a single article priced above this. */
  approvalThresholdUsd: number;
}

export interface BuyContext {
  articlePriceUsd: number;
  publisherKya: number;
  spentTodayUsd: number;
}

export interface BuyDecision {
  action: "buy" | "skip" | "escalate";
  reason: string;
}

export function decideBuy(ctx: BuyContext, policy: FleetPolicy): BuyDecision {
  if (ctx.publisherKya < policy.minPublisherKya) {
    return { action: "skip", reason: `publisher KYA ${ctx.publisherKya} < min ${policy.minPublisherKya}` };
  }
  if (ctx.articlePriceUsd > policy.approvalThresholdUsd) {
    return { action: "escalate", reason: `price $${ctx.articlePriceUsd} > approval threshold $${policy.approvalThresholdUsd}` };
  }
  if (ctx.articlePriceUsd > policy.perTxCapUsd) {
    return { action: "skip", reason: `price $${ctx.articlePriceUsd} > per-tx cap $${policy.perTxCapUsd}` };
  }
  if (ctx.spentTodayUsd + ctx.articlePriceUsd > policy.dailyBudgetUsd) {
    return { action: "skip", reason: `would exceed daily budget $${policy.dailyBudgetUsd}` };
  }
  return { action: "buy", reason: `KYA ${ctx.publisherKya} trusted, $${ctx.articlePriceUsd} within caps` };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Implement `agent/research-agent.mts`**

First **read `agent/buyer.mts` fully** — you will reuse its `GatewayClient` (ephemeral wallet + `gateway.deposit`), `getAgentHeaders()`, and `checkAndRedeposit()` exactly. `research-agent.mts` is buyer.mts's decision-making sibling: instead of hammering one endpoint, it lists articles, reads the publisher's AgentScore, decides per article, and pays only what it chooses.

Requirements for `agent/research-agent.mts` (model its wallet/deposit/pay plumbing on buyer.mts; **node import extensions are required** — `import { decideBuy, type FleetPolicy } from "../lib/fleet/decide.ts"`):
- Read config from argv/env: `--base <url>` (default `http://localhost:3000`), `--dry-run` (no network payments — decide + print only), and a policy from flags/env with defaults `{ minPublisherKya: 50, perTxCapUsd: 0.01, dailyBudgetUsd: 0.5, approvalThresholdUsd: 0.05 }`.
- Fetch `GET {base}/api/scores` (free) and `GET {base}/api/articles` (free).
- Determine the publisher KYA: find the row in `/api/scores` whose `agentId` === the articles' `publisherAgentId` (fall back to `0` if absent).
- For each article: call `decideBuy({ articlePriceUsd: a.priceUsd, publisherKya, spentTodayUsd }, policy)`. Log a one-line decision (`BUY/SKIP/ESCALATE — <reason>`). On `buy` (and NOT `--dry-run`): pay `GET {base}/api/article/{id}` via the reused `GatewayClient` payment flow (x402: 402 → sign → retry) with `getAgentHeaders()`; on success add `a.priceUsd` to `spentTodayUsd`. On `escalate`: log and skip the payment (no human channel in the fleet). On `skip`: log.
- In `--dry-run`: do all of the above EXCEPT real payment and EXCEPT wallet/deposit setup — just print the decisions. This is the verifiable path.
- Add a `"research-agent"` script to `package.json`:
  `"research-agent": "node --experimental-transform-types --no-warnings --env-file=.env.local agent/research-agent.mts"`

- [ ] **Step 6: Verify the fleet decision loop with `--dry-run`** (no network/wallet)

The dry-run must work even with the dev server down for `/api/scores`/`/api/articles` — handle fetch failure by treating publisher KYA as `0` and still printing decisions over a STATIC fallback article list embedded for dry-run, OR (preferred) run the dev server and point `--base` at it. With `npm run dev` running:

```bash
node --experimental-transform-types --no-warnings agent/research-agent.mts --dry-run --base http://localhost:3000
```

Expected: it prints one `BUY/SKIP/ESCALATE — <reason>` line per article and exits 0, making NO payments. (If the publisher has no AgentScore yet, expect SKIPs on the KYA gate — that is correct behavior; lower `--min-kya 0` to see BUY decisions.) Confirm `npm test` is still green and `npx tsc --noEmit` is 0 errors.

- [ ] **Step 7: Commit**

```bash
git add lib/fleet/decide.ts lib/fleet/decide.test.ts agent/research-agent.mts package.json
git commit -m "feat(fleet): research-agent buy/skip/escalate decision core and fleet loop"
```

---

### Task 5: Traction script + final build gate

**Files:**
- Create: `scripts/traction.mts`
- Modify: `package.json` (add `traction` script)
- Test: manual (run the script) + `npm run build`

**Interfaces:**
- Reads `.data/payments.json` (via `../lib/store.ts`'s `listPayments`/`getStats`).

- [ ] **Step 1: Implement `scripts/traction.mts`** (node import extensions required)

```ts
/**
 * Summarize on-chain PressPay traction and best-effort feed it to the hackathon's
 * arc-canteen CLI. Degrades gracefully when arc-canteen is not installed.
 *
 *   npm run traction          # print the summary
 *   npm run traction -- --push  # also try `arc-canteen update traction`
 */
import { spawnSync } from "node:child_process";
import { listPayments, getStats } from "../lib/store.ts";

const push = process.argv.includes("--push");

const [stats, payments] = await Promise.all([getStats(), listPayments(1000)]);
const articlePayments = payments.filter((p) => p.endpoint.startsWith("/api/article/") || p.endpoint === "/api/tip");
const uniqueAgents = new Set(payments.map((p) => p.agentId).filter(Boolean)).size;
const totalToCreator = articlePayments.reduce((s, p) => s + parseFloat(p.amountUsdc || "0"), 0);

const summary = {
  totalPayments: stats.count,
  articleUnlocksAndTips: articlePayments.length,
  usdcToCreator: Number(totalToCreator.toFixed(6)),
  uniqueAgents,
  byEndpoint: stats.byEndpoint,
};

console.log("PressPay traction:");
console.log(JSON.stringify(summary, null, 2));

if (push) {
  const res = spawnSync("arc-canteen", ["update", "traction", "--json", JSON.stringify(summary)], { stdio: "inherit" });
  if (res.error) {
    console.warn("\n[traction] arc-canteen not available — skipped push. Install the ARC CLI to enable it.");
  }
}
```

Add to `package.json` scripts:
`"traction": "node --experimental-transform-types --no-warnings scripts/traction.mts"`

- [ ] **Step 2: Verify the script runs**

Run: `node --experimental-transform-types --no-warnings scripts/traction.mts`
Expected: prints `PressPay traction:` followed by a JSON summary (zeros/empty are fine on a clean store; existing `.data/payments.json` will show real counts). It must exit 0 and NOT throw. Run again with `-- --push` (no `arc-canteen` installed) and confirm it prints the graceful warning, not a stack trace:

Run: `node --experimental-transform-types --no-warnings scripts/traction.mts --push`
Expected: the summary, then the `[traction] arc-canteen not available — skipped push.` warning, exit 0.

- [ ] **Step 3: Final build / type / test gate**

```bash
npm test          # all green (articles + decide + agentscore + guardrail)
npx tsc --noEmit  # 0 errors
npm run build     # succeeds; /press, /press/article/[id], ƒ /api/articles, ƒ /api/article/[id], ƒ /api/tip all in the route list
```

Expected: build succeeds and the new press routes/pages appear.

- [ ] **Step 4: Commit**

```bash
git add scripts/traction.mts package.json
git commit -m "feat(fleet): traction summary script with best-effort arc-canteen push"
```

---

## Self-Review (completed by author)

**Spec coverage (vs `2026-06-17-presspay-design.md` §4 Components 3 & 4 + traction glue):**
- Pay-per-article + tip in sub-cent USDC → Tasks 1–2 (`withPaywall` per-article price + `/api/tip`). ✓
- Publication front + earnings dashboard → Task 3 (`/press` + live earnings from the payment store). ✓
- Research-agent fleet: list → AgentScore → decide buy/skip/escalate → pay → spend tracking → redeposit → Task 4 (`decideBuy` + `research-agent.mts` reusing buyer.mts). ✓
- The buy/skip/escalate "decision cam" demo moment → `decideBuy` returns the action + reason the loop logs. ✓
- Traction reporting via arc-canteen → Task 5 (best-effort). ✓

**Deliberate deviations (documented in Out of scope):** browser-wallet human unlock/tip deferred (showcase + agent-paid); Circle Agent Wallet bootstrap + live fleet run + real arc-canteen push are user-side (need funded testnet / Circle CLI auth / ARC-cli); the fleet reads the FREE `/api/scores` for the publisher KYA (the paywalled `/api/score` remains the sellable product). The `--dry-run` path is the verifiable substitute for the live run.

**Placeholder scan:** none — pure modules have full code + tests; routes/pages have full code + curl/visual checks; the `.mts` files have full code (traction) or a complete prose+interface spec keyed to the real `buyer.mts` (research-agent), with a runnable `--dry-run` gate.

**Type consistency:** `Article` shape matches across `lib/articles.ts`, the routes, and the pages; `FleetPolicy`/`BuyContext`/`BuyDecision` match between `decide.ts`, its test, and `research-agent.mts`'s usage; `withPaywall(handler, "$<price>", endpoint)` matches the real signature; `listPayments`/`getStats`/`PaymentEvent.endpoint` match `lib/store.ts`. Leaf modules (`articles.ts`, `decide.ts`) are import-free so they resolve under both Next (extensionless) and node (`.ts`) — the one cross-regime hazard, explicitly guarded.
