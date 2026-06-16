# Agent-to-agent jobs (ERC-8183)

Where the x402 paywall is "an agent **buys an API call**", ERC-8183 is "an agent **hires another
agent to do a job**" — with USDC held in on-chain escrow until the work is approved. PayGate402 wires
this to the same ERC-8004 identities it already uses, closing the loop:

> **identity → get hired → deliver → get paid → earn reputation → get hired again**

## The contract

Arc Testnet ships a reference **AgenticCommerce** implementation:

- Address: `0x0747EEf0706327138c69792bF28Cd525089e4583` (proxy; impl `0xa316fd02…`)
- USDC escrow asset: `0x3600000000000000000000000000000000000000`
- ABI captured in [`lib/erc8183.ts`](../lib/erc8183.ts)

## Roles

| Role | Who | Does |
| --- | --- | --- |
| **Client** | the hirer | creates the job, funds the USDC escrow |
| **Provider** | the worker agent | sets the budget, submits the deliverable |
| **Evaluator** | the verifier | approves the deliverable, releasing escrow (earns `evaluatorFeeBP`) |

## Lifecycle

```
createJob(provider, evaluator, expiredAt, description, hook)   // client  -> jobId, status Open(0)
setBudget(jobId, amount, optParams)                            // provider sets the price
approve(AgenticCommerce, amount) + fund(jobId, optParams)      // client   -> status Funded(1)
submit(jobId, keccak256(deliverable), optParams)               // provider -> status Submitted(2)
complete(jobId, keccak256(reason), optParams)                  // evaluator-> status Completed(3), USDC released
```

Status enum (from `jobs(jobId).status`): `0 Open · 1 Funded · 2 Submitted · 3 Completed · 4 Rejected ·
5 Expired · 6 Refunded`. Terminal alternatives: `claimRefund` (expired/rejected) refunds the client.
Events narrate the flow: `JobCreated · BudgetSet · JobFunded · JobSubmitted · JobCompleted ·
PaymentReleased · EvaluatorFeePaid`.

## Run it

```bash
npm run run-job
```

[`scripts/run-job.mts`](../scripts/run-job.mts) orchestrates the whole thing on testnet:

1. Client = your `BUYER` wallet. It generates a **provider** and **evaluator** wallet and funds their gas.
2. The provider **registers its own ERC-8004 identity** (so it's a real, rateable agent).
3. The full job lifecycle runs: create → setBudget → approve+fund → submit → complete.
4. The client leaves **ERC-8004 reputation feedback** for the provider agent.

## A real run (Arc testnet)

```
[1] provider registers an ERC-8004 identity...
    provider is on-chain agent #670635
[2] creating job (budget 0.05 USDC, evaluator fee 0%)...
    job #124027 created        status: 0 (Open)
[3] provider sets budget...
[4] client approves + funds USDC escrow...
                               status: 1 (Funded)
[5] provider submits deliverable hash...
                               status: 2 (Submitted)
[6] evaluator approves -> releases escrow...
                               status: 3 (Completed)
    provider received 0.05 USDC
[7] client leaves ERC-8004 feedback for the provider agent...
✅ Agent #670635 was hired, delivered, got paid, and earned reputation.
```

- Provider identity: <https://testnet.arcscan.app/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/670635>
- Job creation tx: `0x29fe9f5b2fc2acf645724fa287fbe98184652815d8f6afd6c72cc757cbeef3bb`
- Escrow release tx: `0x55c97e6abe6ebf8de23f0028683f6105cc349cdd13fa5b6ba575a78f54449e05`

## Notes & caveats

- **Testnet only.** The provider/evaluator wallets are generated per run; their gas is topped up from
  the client. Never reuse these keys with real funds.
- The reference contract's `evaluatorFeeBP` is currently `0` on testnet, so the provider receives the
  full budget and no `EvaluatorFeePaid` event fires. With a non-zero fee, escrow splits provider/evaluator.
- The deliverable is committed on-chain only as a `keccak256` **hash**; the actual artifact is exchanged
  off-chain. "Evaluation" here is a wallet approving — production systems would wire an AI evaluator (or a
  dispute/`hook`) that actually checks the work before calling `complete`.
- Occasional transient RPC reverts on a step are safe to retry; the lifecycle is idempotent per job id.
- This is a reference implementation, not a ratified EIP — treat addresses/ABIs as Arc-testnet specifics.
