# PressPay — Design Spec

**Date:** 2026-06-17
**Author:** macx (solo) + Claude
**Status:** Approved (design); pending implementation plan
**Target:** Lepton Agents nanopayments hackathon (Canteen × Circle × Arc), Jun 15–29 2026, async-judged, $50K pool
**Builds on:** PayGate402 (existing x402 paywall at this repo)

---

## 1. One-line pitch

**PressPay — "the autonomous newsroom that pays for its own sources."** A real, deployed pay-per-article publication on Circle Arc where readers (and a fleet of autonomous research agents) unlock single articles for sub-cent USDC and tip creators. The agents govern their own spend through **GuardRail** (a reputation-aware policy firewall) and decide *which* publishers to pay by reading **AgentScore** (a 0–100 Know-Your-Agent trust score). The creator-facing product is the front door; GuardRail + AgentScore are the differentiated infra revealed as the "why this is safe and defensible" layer.

## 2. Why this shape (strategy)

The hackathon judges weight **Agentic Sophistication 30% · Traction (real users/payments/volume) 30% · Circle tool usage 20% · Innovation 20%**, async review (no live demo day), and the round explicitly **leans toward RFB-06 (Creator & Publisher Monetization)**. Pure infra/tooling submissions historically cap at honorable-mention in this lineage; the winning shape is a human-legible creator product sitting on real agent infra (cf. NewsFacts — 1st at Agentic Commerce on Arc with pay-per-fact; Versus — HackMoney with agentic creator monetization).

PressPay leads with **RFB-06** while quietly satisfying **RFB-01** (autonomous paying agents), **RFB-03** (agent-to-agent reputation/escrow networks), and **RFB-05** (infra & tooling). GuardRail + AgentScore — the user's chosen builds — are the engine, not the headline.

## 3. Approved decisions

| Decision | Choice |
|---|---|
| Product shape | **PressPay** (creator front + GuardRail/AgentScore engine) |
| Circle Agent Wallet | **Hybrid** — one real Agent-Wallet-funded tx on camera for the tooling axis; the 50+ traction txns run through the proven `@circle-fin/x402-batching` path; Agent Wallet documented as the mainnet/production path |
| Content brand | **The builder's own Arc/crypto explainer publication** — fastest, full content control, recruit real readers from Canteen/Arc Discords |
| Traction target | **50+ on-chain sub-cent settlements (floor)** + real human tippers + 1–2 design-partner quotes |
| Settlement rail | **Keep `@circle-fin/x402-batching`** (GatewayWalletBatched); do NOT migrate |

Minor defaults (tunable during build):
- **KYA weights:** `kya = 0.5·reputation + 0.25·jobCompletionRate + 0.25·paymentReliability`. Payment reliability is the densest signal we can generate on testnet, so it may be bumped during Day 5 tuning.
- **HITL approval UX:** web approval queue (cleanest for the video); optional notification channel later.
- **CIRCLE-FEEDBACK.md:** candid-but-constructive about Agent Wallet testnet rough edges (more credible; claims the $500 feedback incentive).

## 4. Architecture

### Data flow
```
Reader / Research-Agent
  → PressPay front-end (NEW, thin)
  → withPaywall()-protected /api/article/[id]   (REUSE lib/paywall.ts)
  → GuardRail.evaluate()  interposed BEFORE facilitator.settle()   (NEW engine, wraps REUSED agentauth + reputation)
  → Circle Gateway batched settle   (REUSE)
  → recordPayment(...)   (REUSE lib/store.ts, extended schema)
  → AgentScore indexer reads store + jobs + ERC-8004/8183   (NEW indexer over REUSED reads)
  → publisher/agent trust score → feeds GuardRail.reputationScaledLimit AND the agent's buy/skip/escalate decision
```

### Component 1 — GuardRail policy engine (NEW)
- **Files:** `lib/guardrail/{policy,engine,velocity}.ts`; `.data/policies.json`, `.data/pending-approvals.json`; `app/api/guardrail/{policies,pending,approve}/route.ts`.
- **Interface:**
  `evaluate(ctx: {agentId, agentAddress, merchantId, endpoint, amountUsdc}) → {decision: 'allow'|'deny'|'escalate', reason, appliedTier, remainingDaily}`
- **Composes:** (a) per-merchant allowlist; (b) `VelocityBucket` sliding-window rate check (NEW state machine); (c) reputation-scaled cap `= f(getReputation(agentId).score)` (REUSE `lib/reputation.ts`); (d) Circle `circle wallet limit` caps read as a documented hard floor (mainnet integration point); (e) HITL: amounts over threshold return `'escalate'`, enqueue to `.data/pending-approvals.json`, and **pause settle** until `/api/guardrail/approve`.
- **Interposition:** `lib/paywall.ts` gets a ~15-line refactor to call `guardrail.evaluate()` between `verifyAgentControl()` and `facilitator.settle()`; **default no-op** so existing behavior is unchanged when no policy is set.
- **Reuses:** `verifyAgentControl()` + `getControllers()` (agentauth.ts) as the signer boundary; `buildPaymentRequirements` + `recordPayment` (store.ts, extended `PaymentEvent` with `policyTier`, `decision`, `remainingDaily`, `velocityBucket`).

### Component 2 — AgentScore indexer (NEW)
- **Files:** `lib/agentscore/{index,kya,metadata}.ts`; `.data/agent-scores.json`, `.data/agent-metadata.json`; `app/api/score/route.ts` (sold via `withPaywall`); `app/explorer/page.tsx`.
- **Interface:**
  `getScore(agentId) → {agentId, kya: 0-100, breakdown:{reputation, jobCompletion, paymentReliability}, rank, trend}`
  `listScores({sort, limit}) → ScoreRow[]`
- **KYA formula:** `kya = 0.5·normalize(ERC8004 reputation) + 0.25·jobCompletionRate + 0.25·paymentReliability` (tunable).
- **Reuses:** `getReputation` / `ReputationRegistry.getSummary` (reputation.ts); `JobRecord` + `JOB_PHASES` (jobs.ts) for completion rate; `PaymentEvent` + `listPayments` + `getStats` (store.ts) for reliability; `agentControlMessage` + `tokenURI` (erc8004.ts) for metadata.
- **Net-new:** a lightweight poll indexer (setInterval daemon, or recompute-on-read with 60s cache) aggregating the three signals; metadata fetch (`tokenURI → agent-card.json`, 1h cache); ranking/trend view schema. AgentScore is itself sold via `withPaywall` (agents pay to read a score) — closing the loop.

### Component 3 — Creator front (NEW but thin)
- **Files:** `app/(press)/page.tsx` (article list); `app/(press)/article/[id]/page.tsx` (x402 unlock + tip button); `app/api/article/[id]/route.ts = withPaywall(serveArticle, price, endpoint)`; seed content in `.data/articles.json` or MDX; an earnings dashboard.
- **Reuses:** `withPaywall` directly; existing `app/dashboard` UI patterns (score/count badge, payment timeline, agent links). Tipping = a second `withPaywall` endpoint at variable price.

### Component 4 — Research-agent fleet (REUSE + extend)
- **Files:** `agent/buyer.mts → agent/research-agent.mts`; `scripts/circle-agent-wallet.mts`.
- **Reuses:** `GatewayClient.pay` loop, `getAgentHeaders()`, deposit/redeposit.
- **Net-new decision loop:** (1) list articles, (2) call AgentScore on the publisher, (3) ask GuardRail (local policy mirror) buy/skip/escalate, (4) pay under cap. This is the autonomy story.

### Circle stack glue (NEW)
- `scripts/circle-agent-wallet.mts` bootstraps an agent wallet via Circle CLI (`circle wallet login --type agent --init`); install `circlefin/skills` (`/plugin marketplace add circlefin/skills`) + Circle MCP; document every touchpoint in README + `CIRCLE-FEEDBACK.md`.
- **Settlement stays** on `@circle-fin/x402-batching` (GatewayWalletBatched scheme already in `paywall.ts`).

### Traction glue (NEW)
- `scripts/traction.mts` wires real payment/score events into `arc-canteen update traction` + `update product` + `push` so the judges' dashboard is machine-fed/verified.

## 5. Tooling recommendation (resolved)

**Dual-stack.** Keep `@circle-fin/x402-batching` as the settlement engine (it is already Gateway-batched nanopayments and even fixes a stale `345600` validity-window bug the reference repo ships — ripping it out gains zero function and burns 2–3 days of regression risk). **Add** Circle CLI + Agent Wallets + Skills/MCP as the headline-visible Agent Stack to capture the 20% tooling score cheaply (~1–1.5 days, additive). Position GuardRail as the richer policy layer **on top of** Agent Wallets' native `circle wallet limit` (reads those caps as a floor) — which also scores Innovation. Hybrid insurance: if Agent Wallet testnet is rough, demo one real Agent-Wallet tx on camera and run traction volume through x402-batching.

## 6. How each judging axis is hit

- **Sophistication (30%):** genuine per-article **decision-making** (buy/skip/escalate) reasoning over AgentScore KYA + GuardRail cap/velocity + HITL threshold — not a cron job. Show the agent skipping a low-trust publisher and escalating a too-large spend. Two products form **one coherent system** (AgentScore feeds GuardRail).
- **Traction (30%):** 50+ real on-chain sub-cent settlements from the autonomous fleet (clears the Agentic-Economy-on-Arc de-facto bar) + real human tippers recruited from Discords + 1–2 design-partner quotes; surfaced in an earnings dashboard with live Arc explorer tx links; machine-fed via `arc-canteen`.
- **Circle tooling (20%):** visible adoption of Wallets + CLI + Gateway-powered Nanopayments + Skills + MCP; GuardRail explicitly extends the Agent Wallet policy primitive; one real Agent-Wallet tx on camera; `CIRCLE-FEEDBACK.md` ($500 incentive).
- **Innovation (20%):** two primitives Circle's stack lacks — (1) GuardRail = reputation-aware allowlist+velocity+HITL policy layer over Agent Wallets; (2) AgentScore = a 0–100 KYA trust oracle over ERC-8004 identity + ERC-8183 escrow + payment reliability (Circle's Agent Marketplace has no equivalent).

## 7. Traction plan (12-day async window)

1. **Agent fleet (machine floor):** 3–5 research agents on a loop over the final ~5 days, each under a distinct GuardRail policy, paying $0.002–$0.01/article; target **50+** on-chain settlements; self-sustaining via existing auto-redeposit.
2. **Real humans (credibility):** deploy live link by Day 4–5; post in Canteen + Arc Discords + builder's social; recruit 5–15 real readers/tippers.
3. **Design-partner quotes (highest leverage):** DM 3–4 indie creators / OSS maintainers; get 1–2 on-record quotes about monetizing single pieces without subscriptions → README + video.
4. **Machine-verified reporting:** `the-canteen-dev/ARC-cli` + `scripts/traction.mts` → `arc-canteen update traction/product` + `push` daily.
5. **Proof device:** earnings dashboard + live Arc block-explorer links in the video.

## 8. Build plan (milestones, GuardRail-first)

- **D1** Foundation + Circle stack: add guardrail interposition hook to `paywall.ts` (no-op default); install Circle CLI, create one agent wallet, install Skills + MCP; `scripts/circle-agent-wallet.mts`. Commit + push.
- **D2** GuardRail core: `lib/guardrail/policy.ts` (schema + `.data/policies.json`), `engine.ts` `evaluate()` with allowlist + reputation-scaled cap (reuse `getReputation`). Unit-test allow/deny.
- **D3** GuardRail velocity + HITL: `lib/guardrail/velocity.ts` sliding window; escalate path + `.data/pending-approvals.json`; `app/api/guardrail/{pending,approve}`. Wire engine into `paywall.ts` for real. Read `circle wallet limit` as documented floor.
- **D4** GuardRail dashboard + **first deploy** (Vercel). `app/api/guardrail/policies` + live allow/block/escalate panel. Extend `PaymentEvent` schema. **GuardRail DONE.**
- **D5** AgentScore indexer: `lib/agentscore/{kya,index}.ts` aggregating reputation + job completion + payment reliability. `app/api/score` via `withPaywall`. Tune KYA weights.
- **D6** AgentScore explorer + metadata: `app/explorer/page.tsx`, `lib/agentscore/metadata.ts`. Wire AgentScore back into GuardRail's reputation-scaled limit. **AgentScore DONE.**
- **D7** Creator front-end: `app/(press)` list + `article/[id]` (x402 unlock + tip); `app/api/article/[id]`; seed 6–10 real articles; earnings dashboard.
- **D8** Research-agent fleet: `agent/research-agent.mts` decision loop; bootstrap 3–5 agents w/ distinct policies + Circle Agent Wallets; demo one real Agent-Wallet-funded tx.
- **D9** Traction harness: install ARC-cli, `scripts/traction.mts`; start fleet on a loop; post live link to Discords; begin recruiting tippers + design partners.
- **D10** Polish + real traction accrual; collect design-partner quotes; README (Circle stack, GuardRail-extends-Agent-Wallets framing, mainnet floor note) + `CIRCLE-FEEDBACK.md`.
- **D11** Record <3min video; capture live Arc explorer tx hashes; final dashboard screenshots.
- **D12** Buffer: fix demo-blocking bugs; finalize submission (repo, video, live link, traction data); final `arc-canteen push`.

## 9. Demo plan (<3min, 4 beats)

1. **(~25s) Human cold-open:** indie creator who can't monetize a single piece without a subscription; show a PressPay article behind a $0.003 paywall.
2. **(~60s) The WOW:** on the live link, a reader then an autonomous agent unlocks one article for sub-cent USDC and tips → cut to the **Arc block explorer showing the real tx settling**. The single screen that wows: a **split-screen "agent decision cam"** — left shows the agent's live reasoning (`publisher AgentScore 82 → trusted; GuardRail: $0.003 within daily cap + velocity OK → BUY`), right shows it skipping a low-AgentScore publisher and **escalating a $0.50 spend to a human approval queue** (click approve, settle resumes). The allow/skip/escalate triptych proves the AI *decides*.
3. **(~45s) Infra reveal:** GuardRail = reputation-aware policy layer **on top of** Circle Agent Wallets (show the CLI agent wallet + native limit as a floor); AgentScore = the KYA oracle Circle's Agent Marketplace lacks, indexing ERC-8004 + ERC-8183.
4. **(~20s) Traction:** earnings dashboard — total USDC paid to the creator, 50+ tx count (the approved floor; higher if accrued), reader-to-payer conversion, live explorer links, the `arc-canteen` traction dashboard, a design-partner quote on screen.

## 10. Risks & mitigations

- **Scope (3 new surfaces, solo, 12 days):** GuardRail-first with a deployable D4 checkpoint; AgentScore + front-end reuse ~80% of existing reads/UI; the paywall change is ~15 lines.
- **Too-much-infra trap (reads as two demos):** lead the video with the human creator story; frame GuardRail+AgentScore as ONE system (AgentScore feeds GuardRail) revealed second.
- **Circle Agent Wallet testnet roughness:** hybrid — one real Agent-Wallet tx on camera; traction volume through x402-batching; Agent Wallet documented as mainnet integration.
- **Traction looks self-dealing:** mix in real human tippers + 1–2 design-partner quotes; machine-feed `arc-canteen` so it's verified.
- **`circle wallet limit` is mainnet-only:** GuardRail enforces independently on testnet; read Circle caps as a documented production floor (call this out — shows awareness, not a gap).
- **Cache TTL mismatch** (reputation.ts 30s vs agentauth.ts 60s) could serve stale controllers after feedback writes: add `clearReputationCache` on feedback write; document.
- **JSON-file store write contention** under a live fleet: existing lock serialization handles ~1/sec; if the fleet pushes harder, raise the cap or move payments to SQLite — only if it actually contends.

## 11. Out of scope (YAGNI)

- Real secure-signer/enclave boundary (Ledger/threshold sig) — documented as production path, not built.
- Full Agent-Wallet-funded fleet (hybrid instead).
- Multi-chain / CCTP cross-chain flows.
- ERC-8183 dispute/refund arbitration (separate future project).
- SQLite migration unless write contention is actually observed.

## 12. Remaining open questions (non-blocking)

- Exact article topics within the Arc/crypto explainer niche (recruit-ability > topic).
- Whether to push traction past the 50+ floor toward 100+/a named payout figure if time allows.
- Final KYA weight tuning after observing testnet signal density.
