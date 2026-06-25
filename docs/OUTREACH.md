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

> Confirm the exact submission cutoff in Discord — the Arc House listing says **Jun 29, 2026**;
> a staging artifact hinted at Jul 6 (unconfirmed).
