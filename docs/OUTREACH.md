# PressPay — outreach kit (get genuine external traction)

Traction (30% of the Lepton Agents score) is **qualitative**: "genuine usage during the
event window — people actually using it, payments actually flowing in test USDC." There is
**no numeric threshold**. The submission form asks for **"unique paying clients"**, so a
looped self-agent (`#668408`) counts as **one** payer no matter how many times it runs — and
self-dealing volume reads as wash trading to judges who inspect the chain.

**So: don't inflate your own fleet. Recruit a handful of *distinct external* payers.** The
`/dashboard` "Traction" section separates self-dogfood from genuine external payers
automatically (keyed on ERC-8004 agent id / wallet), so every real participant shows up.

Highest-yield move: **reciprocal agent-to-agent runs** with other teams (also nails the
agent-to-agent RFB). Two independent counterparties beat 100 self-loops.

---

## ① "Try it" block (pin this; every post links here)

```
🗞️ Try PressPay — autonomous agents pay per article in sub-cent USDC on Circle Arc

▶ Live:      https://paygate402-two.vercel.app/press
▶ Dashboard: https://paygate402-two.vercel.app/dashboard   (watch your payment land live)
▶ Repo:      https://github.com/BornToTry2022/paygate402

Point your agent at my paywall (~2 min):

  git clone https://github.com/BornToTry2022/paygate402 && cd paygate402
  npm install && cp .env.example .env.local
  # set BUYER_PRIVATE_KEY to a funded Arc-testnet wallet  (faucet: https://faucet.circle.com)
  npm run agent -- --base https://paygate402-two.vercel.app --limit 0.05

Your agent pays for a few articles via Circle Gateway batching and shows up on the
dashboard as a distinct EXTERNAL payer (your own wallet + ERC-8004 agent id). All on-chain,
verifiable on https://testnet.arcscan.app.

🔁 RECIPROCAL: drop your x402 paywall URL (or agent wallet) and I'll point my agent at
yours — real, distinct, cross-team traffic for both of us. Reply your tx, I'll reply mine.
```

## ② Discord post (Lepton/Canteen `discord.gg/rsVfYutFZg` + Arc community)

```
Hey builders 👋 I shipped PressPay — a pay-per-article publication on Circle Arc where the
buyers are autonomous AI agents.

Each agent looks up a trust score (AgentScore — a 0–100 KYA oracle over ERC-8004 reputation
+ ERC-8183 jobs) and stays inside a spend policy (GuardRail — a spend firewall with caps +
human-approval) before paying sub-cent USDC through Circle Gateway batching.

It's live and I'd love genuine, distinct usage during the window 🙏
→ Try it / point your agent here: [link to your pinned "Try it" message]

🔁 Especially keen on RECIPROCAL agent-to-agent runs: you send your agent at my paywall, I
send mine at yours — we both get real cross-team traffic, and it nails the agent-to-agent
RFB. Drop your URL / agent wallet below and let's swap 👇
```

## ③ X / Twitter post

```
🗞️ PressPay is live on @circle Arc — a pay-per-article publication where the buyers are
autonomous AI agents.

Each agent checks a trust score + stays inside a spend policy, then pays sub-cent USDC via
Circle Gateway batching.

Point your agent at my paywall 👇 reply your tx & I'll send mine back.
https://paygate402-two.vercel.app/press

#x402 #LeptonAgents #CircleArc
```

## ③b Quote-tweet @circle (highest-leverage X move)

Find @circle's post about *"agents that can hold a wallet, manage a budget, discover paid
services, pay in USDC"* → Repost → **Quote**, and map each ask to PressPay. Don't start the
tweet with `@circle` (X treats a leading @ as a reply and suppresses reach — the quoted post
already references them).

**Recommended (≤280 chars, works without X Premium):**

```
You just described PressPay 👇

🤖 holds a wallet → on-chain ERC-8004 identity
💰 manages a budget → GuardRail spend firewall
🔎 finds & vets paid services → x402 + AgentScore
💵 pays in USDC → sub-cent, via Circle Gateway on @arc

Live: paygate402-two.vercel.app #x402
```

**Longer (X Premium / more detail):**

```
You just described what I built for the @thecanteenapp x @circle hackathon 👇

PressPay — autonomous agents that pay per article in sub-cent USDC:
🤖 hold a wallet → on-chain ERC-8004 identity (not just an address)
💰 manage a budget → GuardRail spend firewall: caps, velocity, human-approval
🔎 discover & vet paid services → x402 paywall + AgentScore (0–100 KYA trust)
💵 pay in USDC → batched sub-cent settlement via Circle Gateway, on @arc (testnet)

Built on the Circle Agent Stack. Point your agent at it 👇
paygate402-two.vercel.app  ·  github.com/BornToTry2022/paygate402
#x402 #LeptonAgents
```

**Reply under your own quote-tweet (keeps the demo + reciprocal ask off the main post):**

```
2-min walkthrough + the agent decision loop (buy/skip/escalate) here 👇
[your YouTube/Loom link]

Running an x402 agent? Point it at my paywall and I'll point mine back — reply with your tx 🤝
```

---

## How to run the campaign

1. Post ② in the Lepton/Canteen Discord + Arc community; pin ① and your `/dashboard` link as a
   live scoreboard. Then post ③ on X to widen reach.
2. **Reciprocal first** — ask "who wants to swap agent payments?" Each independent team you swap
   with = a real distinct external payer (and an agent-to-agent data point).
3. Recruit 5–15 real human testers/tippers; capture 1–2 quotes ("readers paying" is the exact
   creator-build signal judges name).
4. Every external payer must use **their own** wallet/agent id (never proxy via your key). Don't
   fabricate diversity with throwaway wallets funded from one source — that's traceable wash.
5. In the submission, report the honest split:
   *"Self-dogfood baseline: N payments from our fleet (rail works end-to-end). External traction
   during the window: X distinct human readers + Y independent agents from Z teams, $P test-USDC,
   all on-chain (links)."*

> **Deadline:** the official Canteen page (lepton.thecanteenapp.com) shows **July 6, 2026, 11:59 PM ET**
> (an earlier Arc House listing said Jun 29). Confirm in Discord — but you likely have until Jul 6.

---

## Where else to post — communities (verified 2026-06-25)

You've already posted in the **Lepton/Canteen Discord** (`discord.gg/rsVfYutFZg`). Other high-value
rooms, ranked for recruiting agent builders who can reciprocate. Post ONCE per server, in the
#showcase / #show-and-tell / #self-promo channel only (never #help/#general/support), leading with
the live link + a one-line "point your agent at my paywall, I'll point mine at yours."

| Community | Link | Why |
|---|---|---|
| **Coinbase CDP** (the x402 builder hub) | `discord.gg/cdp` | Densest concentration of people running x402 agents → best reciprocal traction |
| **Circle Developers** ("Build on Circle") | `discord.gg/buildoncircle` (= `circle.com/discord`) | Hackathon host; Circle DevRel/judges are here |
| **Arc** ("Build on Arc") | `discord.gg/buildonarc` | Arc-native, build-first; most on-target for Arc agents |
| **Arc House** (forum, persistent writeup) | `community.arc.network` | Post a project writeup; feeds the Architects program |
| **ERC-8004 Trustless Agents** (Telegram) | `t.me/ERC8004` | Small (~2.2k) but exactly your stack (ERC-8004/8183) |

**X/Twitter:** post a demo thread tagging **@thecanteenapp + @arc + @circle** (hosts reshare entries)
and **@x402Foundation + @CoinbaseDev** for the protocol crowd. ⚠️ Tag `@x402Foundation`, NOT `@x402`
(a dormant Solana handle). Strong move: quote-tweet @circle's "looking for agents that hold a wallet /
pay in USDC" post.

⚠️ **Avoid:** the "AgentPay x402" Discord (`discord.gg/uEmcWj8xMX`, 40k) is NOT official x402 —
farmer-bloated. There is NO official "Virtuals Discord" (theirs was hacked Jan 2026) — only their TG/X.

## x402 directory listings

**✅ Done for you** — curated GitHub lists that accept Arc/testnet projects (no wallet needed):
- `xpaysh/awesome-x402` → PR [#612](https://github.com/xpaysh/awesome-x402/pull/612)
- `Merit-Systems/awesome-agentic-commerce` → PR [#372](https://github.com/Merit-Systems/awesome-agentic-commerce/pull/372)

**Honest reality — skip the rest for now.** The automated x402 directories/marketplaces are
**Base/Solana-only and do NOT index Circle Arc testnet**, so listing PressPay there yields nothing
as-built:
- **x402scan.com** — indexes only Base + Solana; the submit button stays disabled for an Arc endpoint.
- **Coinbase x402 Bazaar / agentic.market** — only index endpoints settled via the **CDP facilitator**; PressPay settles via **Circle Gateway** on Arc → won't appear.
- **pay.sh** (Solana-mainnet only) · **ampersend** (Base only + account/wallet) · **x402-list.com** (rejects `vercel.app` + needs email).

> Appearing in those scanners would need a **Base/Base-Sepolia "exact"-scheme USDC mirror** of one
> endpoint settled via the CDP facilitator — a future dev task, not required for the hackathon. For now,
> real external traction comes from the **reciprocal swaps in the Discords above**, not directories.
