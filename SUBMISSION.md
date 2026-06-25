# PressPay — Lepton Agents submission

> **One line:** PressPay is an agent-payable publication on Circle Arc whose engine is a fleet of autonomous agents that **pay per article in sub-cent USDC**, govern their own spend through **GuardRail** (a spend firewall), and choose what to trust through **AgentScore** (a Know-Your-Agent score). The reader-facing product is the front door; the trust-and-control layer is what makes autonomous payment safe and defensible.

- **Live link:** **https://paygate402-two.vercel.app** — [`/press`](https://paygate402-two.vercel.app/press) · [`/dashboard`](https://paygate402-two.vercel.app/dashboard) · [`/explorer`](https://paygate402-two.vercel.app/explorer) · [`/guardrail`](https://paygate402-two.vercel.app/guardrail) (real on-chain traction, persisted to Upstash Redis)
- **Video (<3 min):** `<fill in Loom/YouTube link>`
- **Repo:** this repository (public)
- **Primary RFB:** 06 — Creator & Publisher Monetization. **Also:** 01 (Autonomous Paying Agents), 03 (Agent-to-Agent reputation/escrow), 05 (Infra & Tooling).

---

## The problem

By mid-2026 the x402 settlement rail is a commodity — "an agent pays for content" is solved. The unsolved, higher-value problems sit one layer up: **authorization** (what is an agent allowed to spend?), **trust** (is this counterparty worth paying?), and **disputes/audit**. And per the round's own lean, creators still can't monetize a *single* piece without forcing a subscription. PressPay attacks both: a real pay-per-piece product, powered by the trust-and-control layer the agent economy is missing.

## What we built (all on `main`, 71 tests passing, `npm run build` clean, live on Vercel)

| Piece | What it is | Where |
|---|---|---|
| **PressPay** | A pay-per-article + micro-tip publication. Public blurbs, paywalled bodies, live earnings. | `/press`, `lib/articles.ts`, `app/api/article/[id]` (paywalled, per-article price), `app/api/tip` |
| **GuardRail** | An agent **spend firewall**: per-merchant allowlist, daily cap, velocity limit, **reputation-scaled per-tx cap**, and **human-in-the-loop approval**. Interposed in the paywall between *verify* and *settle* — deny → 403, escalate → approval queue, allow → settle. Default-off, so existing endpoints are untouched. | `/guardrail`, `lib/guardrail/*`, admin API (optional `GUARDRAIL_ADMIN_TOKEN` gate) |
| **AgentScore** | A **0–100 KYA trust oracle** over ERC-8004 reputation + ERC-8183 job completion + payment reliability. Free explorer feed; a **paywalled per-agent lookup** (dogfoods our own paywall). | `/explorer`, `lib/agentscore/*`, free `/api/scores`, paywalled `/api/score` |
| **Research-agent fleet** | The autonomy: each agent reads the catalogue, looks up the **publisher's AgentScore**, runs `decideBuy` (**buy / skip / escalate**) against its own policy, and pays only what it chooses — spend bounded by policy caps + a 5 USDC deposit ceiling. | `agent/research-agent.mts`, `lib/fleet/decide.ts` |
| **Traction** | Distinct-payer breakdown — **self-dogfood vs genuine external**, agents vs humans — on `/dashboard`, plus a `npm run traction` summary + best-effort `arc-canteen` push. | `lib/store.ts` (`getTractionBreakdown`), `scripts/traction.mts` |

These compose into **one system**: an agent gets a trust score, is governed by a policy, decides what to pay for, and the creator gets paid — all in USDC, all observable on three live dashboards.

## How it maps to the judging axes

- **Agentic Sophistication (30%)** — genuine *decision-making*, not automation. Each agent reasons per article over (a) the publisher's KYA, (b) its reputation-scaled cap + daily budget, and (c) an escalation threshold, and will **skip a low-trust publisher** and **escalate a too-large spend to a human**. GuardRail independently makes the same allow/deny/escalate call at settlement. The two form one coherent loop (AgentScore → GuardRail/decision).
- **Traction (30%)** — judged on **genuine** usage, so we report it honestly. A **self-dogfood baseline** proves the rail works end-to-end (6 sub-cent settlements = $0.021 to the creator + a completed ERC-8183 job, all on-chain). The live `/dashboard` then **separates self from external** and counts **distinct external payers**, keyed on the stable ERC-8004 id — so a looped self-agent is *one* payer, not inflated volume (the form's "unique paying clients" maps to exactly this). Genuine external usage (other teams' agents + readers paying during the window) is being recruited via reciprocal agent-to-agent runs — see [`docs/OUTREACH.md`](docs/OUTREACH.md); the live count is on the dashboard. `npm run traction` prints the same self-vs-external split.
- **Circle tool usage (20%)** — settlement on **Circle Gateway batching** (the `GatewayWalletBatched` x402 scheme, `@circle-fin/x402-batching`), **USDC on Arc**, x402 v2. GuardRail is positioned as the policy layer *on top of* Circle Agent Wallets' native limits. We also filed concrete tooling feedback — see `CIRCLE-FEEDBACK.md` (claims the $500 incentive) and a GitHub-issue draft for a real settlement bug.
- **Innovation (20%)** — two primitives Circle's stack lacks: **GuardRail** (reputation-aware allowlist + velocity + HITL spend policy) and **AgentScore** (a KYA trust score over ERC-8004/8183 + payment reliability). Circle's Agent Marketplace has no equivalent trust score.

## The demo (<3 min, 4 beats)

1. **(~25s) Human cold-open.** A creator can't monetize a single piece without a subscription. Show a PressPay article behind a `$0.003` paywall (`/press`).
2. **(~60s) The WOW — the "agent decision cam."** Split screen. Left: the agent's live reasoning (`publisher AgentScore 82 → trusted; GuardRail: $0.003 within daily cap + velocity OK → BUY`). Right: it **skips a low-AgentScore publisher** and **escalates a large spend to the `/guardrail` approval queue** — you click approve, settlement resumes. Cut to the **Arc block explorer showing the real tx**. This allow/skip/escalate triptych is the proof the AI *decides*.
3. **(~45s) Infra reveal.** Pull back: GuardRail = the reputation-aware policy layer on top of Circle Agent Wallets; AgentScore = the KYA oracle (`/explorer`) indexing ERC-8004 + ERC-8183.
4. **(~20s) Traction.** The `/dashboard` **Traction** panel: **distinct external payers** (self-dogfood shown separately), USDC to the creator, agents-vs-humans, with clickable on-chain tx + first/last-seen timestamps. `npm run traction` prints the same split.

## Run it

```bash
npm install
npm run dev
#   /press      pay-per-article publication + live earnings
#   /guardrail  spend-firewall dashboard (policy, approval queue, allow/block feed)
#   /explorer   KYA trust-score ranking
npm run research-agent -- --dry-run --base http://localhost:3000 --min-kya 0   # decision loop, prints BUY/SKIP/ESCALATE, no payments
```

**Go live (real on-chain payments):**
1. Fund a wallet at `faucet.circle.com`; set `BUYER_PRIVATE_KEY` (and `SELLER_ADDRESS`) in `.env.local`.
2. `npm run register-agent` + `npm run give-feedback` so the publisher's KYA clears the fleet's `--min-kya` (or run with `--min-kya 0` for a cold start).
3. `npm run research-agent` (no `--dry-run`) — accrues real sub-cent settlements (bounded by the fleet policy + a 5 USDC per-deposit / 5 USDC total-deposit ceiling).
4. `npm run traction` — prints the self-dogfood vs **distinct external payer** split; `--push` best-effort feeds `arc-canteen`.
5. `bash scripts/deploy-vercel.sh` to deploy (after `vercel login`). On serverless the file store can't be written, so set `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (any Upstash Redis) and the stores persist there — this is what makes the public dashboard show real traction. The script also sets `GUARDRAIL_ADMIN_TOKEN` to lock the admin routes for the public link.

## Circle tooling used
- **Circle Gateway** (deposit + batched settlement), the **`GatewayWalletBatched`** x402 scheme via **`@circle-fin/x402-batching@^2.0.4`**, **USDC** on Arc Testnet (`eip155:5042002`), **x402 v2**.
- **Wave 2 (planned before deadline):** Circle CLI (`@circle-fin/cli`) agent wallet for one real Agent-Wallet-funded tx on camera, `circlefin/skills` + Circle MCP — documented as adopted, with feedback appended to `CIRCLE-FEEDBACK.md`.

## Traction results

We report traction the way the rubric asks — **genuine usage** — split honestly, with the live numbers on [`/dashboard`](https://paygate402-two.vercel.app/dashboard).

**Self-dogfood baseline** — *the rail working end-to-end (our own fleet; not counted as external users):*
- 6 paid article unlocks · **$0.021 USDC** to the creator · all sub-cent via Circle Gateway batching, persisted + shown live.
- ERC-8183 agent-to-agent job **#134622** completed — 0.05 USDC escrow → released to provider **#840715**, rated 95 ([tx](https://testnet.arcscan.app/tx/0x373993dad33a446ef4abc9d3eb30bf7400d152b0f8311a5dc7058d459f7d4018)).
- AgentScore live: **#840715** KYA 73 · **#668408** KYA 55 ([`/explorer`](https://paygate402-two.vercel.app/explorer)).

**Genuine external traction** — *the number judges weigh; live on the dashboard's Traction panel:*
- `Distinct external payers`, external payments, external USDC, and agents-vs-humans update in real time as third parties transact. Every external payer uses **their own** wallet/ERC-8004 id, and a looped self-agent collapses to one identity — so the count is honest and can't be gamed.
- Being driven during the event window via **reciprocal agent-to-agent swaps** + reader recruitment — playbook in [`docs/OUTREACH.md`](docs/OUTREACH.md). The submission form's "unique paying clients" = the dashboard's distinct external payers.

## Architecture
```
Reader / Research-agent
  → /press  (publication, live earnings)
  → /api/article/[id]  ── withPaywall($price) ──► GuardRail.evaluate (allow/deny/escalate)
                                                      │ allow
                                                      ▼
                                              Circle Gateway batched settle (USDC)
                                                      │
                                                      ▼
                                              payment store ──► AgentScore (KYA) ──► /explorer
                                                                     │
   research-agent: read AgentScore + catalogue → decideBuy(buy/skip/escalate) → pay ◄┘
```

## More
- Design spec, plans, and full build logs: [`docs/superpowers/README.md`](docs/superpowers/README.md)
- Circle tooling feedback ($500 incentive): [`CIRCLE-FEEDBACK.md`](CIRCLE-FEEDBACK.md) + issue draft in [`docs/feedback/`](docs/feedback/)
