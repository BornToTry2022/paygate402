# PressPay — design, plans & build logs

PressPay is the win-optimized Lepton Agents hackathon build on PayGate402: a pay-per-article publication whose engine is an autonomous research-agent fleet governed by **GuardRail** (a spend firewall) and priced by **AgentScore** (a KYA trust oracle). This folder is the full paper trail, built brainstorm → spec → plan → TDD execution (subagent-driven) → review → merge.

## Spec
- [`specs/2026-06-17-presspay-design.md`](specs/2026-06-17-presspay-design.md) — the approved design: shape (PressPay), the four judging axes, the dual-stack Circle-tooling decision, component architecture (reused vs new files), the 12-day plan, the demo narrative, and risks.

## Plans (each executed task-by-task, TDD, with two-stage review)
1. [`plans/2026-06-17-guardrail.md`](plans/2026-06-17-guardrail.md) — **GuardRail** spend firewall (10 tasks). → `/guardrail`, `lib/guardrail/*`, admin API.
2. [`plans/2026-06-17-agentscore.md`](plans/2026-06-17-agentscore.md) — **AgentScore** KYA oracle (4 tasks). → `/explorer`, `lib/agentscore/*`, free `/api/scores` + paywalled `/api/score`.
3. [`plans/2026-06-17-presspay-fleet.md`](plans/2026-06-17-presspay-fleet.md) — **PressPay front + research-agent fleet + traction** (5 tasks). → `/press`, `lib/articles.ts`, `lib/fleet/decide.ts`, `agent/research-agent.mts`, `scripts/traction.mts`.

## Build logs (decisions, adjudications, deferred items, minor findings)
- [`build-log/2026-06-17-guardrail-build-log.md`](build-log/2026-06-17-guardrail-build-log.md)
- [`build-log/2026-06-17-agentscore-build-log.md`](build-log/2026-06-17-agentscore-build-log.md)
- [`build-log/2026-06-17-presspay-build-log.md`](build-log/2026-06-17-presspay-build-log.md)

All three features are merged to `main`. 64 vitest tests pass; `tsc --noEmit` is clean; `npm run build` succeeds. Each plan passed an opus whole-branch review with no Critical/Important findings before merge.

## Run it locally
```bash
npm run dev
#   /press      pay-per-article publication + live earnings
#   /guardrail  spend-firewall dashboard (policy, approval queue, allow/block feed)
#   /explorer   KYA trust-score ranking
npm run research-agent -- --dry-run --base http://localhost:3000 --min-kya 0   # decision loop, no payments
npm run traction                                                               # traction summary
```

## Open user-actions (to take it live for judging)
- **Register**: Luma code `LEPTONHOUSE` + Canteen/Arc Discords.
- **Fund**: `faucet.circle.com` → set `BUYER_PRIVATE_KEY` in `.env.local`; optionally `npm run register-agent` + `npm run give-feedback` so the publisher's KYA clears the fleet's `--min-kya`.
- **Run live**: `npm run research-agent` (no `--dry-run`) to accrue real sub-cent on-chain payments; live spend is bounded by the fleet policy + a 5 USDC per-deposit and 5 USDC total-deposit ceiling.
- **Deploy**: `npx vercel --prod` + env vars; set `GUARDRAIL_ADMIN_TOKEN` to lock the admin routes for a public deploy (and `localStorage.setItem('guardrail_admin_token', …)` in the dashboard).
- **Submit**: public repo + <3min video + live link + traction data.

## Known deferred items
- **Per-merchant signal isolation** — GuardRail's daily-cap/velocity key on agent/payer only (`PaymentEvent` has no `merchantId`), so caps aggregate across merchants. Fine for the single-publisher demo; a multi-merchant build must add `merchantId` to `PaymentEvent` and filter signals (noted in `lib/guardrail/gate.ts`).
- **Circle Agent Wallet bootstrap** — the one real Agent-Wallet demo tx needs interactive `circle wallet login` (user step); the fleet otherwise runs on the proven ephemeral-wallet + Gateway path.
- **Browser-wallet human unlock/tip** — the `/press` pages are a showcase + earnings; the agents generate the payments (embedded-wallet human payment deferred).
