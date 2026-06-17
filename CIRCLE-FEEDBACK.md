# Circle developer-tooling feedback — PressPay (Lepton Agents)

Candid, reproducible feedback on Circle's developer tooling, captured while building **PressPay** (an agent-payable publication + autonomous buyer fleet) on Arc Testnet. We lead with the hardest findings: a real settlement-blocking bug, then developer-experience friction. Everything here is from first-hand use, with exact values.

**Stack we actually used:** `@circle-fin/x402-batching@^2.0.4` (Circle Gateway batching, the `GatewayWalletBatched` x402 scheme), Circle Gateway deposit + batched settlement, USDC on Arc Testnet (`eip155:5042002`). x402 v2 (`@x402/core@^2.6.0`, `@x402/evm@^2.6.0`).

> **Wave 2 (pending):** Circle CLI (`@circle-fin/cli`), Agent Wallets, Skills/MCP (`circlefin/skills`), and the Nanopayments Gateway product are a planned live step; their DX feedback will be appended below before the June 29 deadline.

---

## 1. [BUG · settlement-blocking] The reference flow ships a stale `345600` authorization-validity window that Gateway now rejects

**What happens:** Following the reference `withGateway` flow, settlement fails with `authorization_validity_too_short`. The 402 challenge and even `verify` can look fine; the failure only surfaces at `facilitator.settle()`, which makes it confusing to diagnose.

**Root cause:** Gateway testnet requires the EIP-3009 authorization to stay valid for at least `minValiditySeconds` (currently **604800 = 7 days**, per `/v1/x402/supported`). The client builds the validity window as `(maxTimeoutSeconds + 600)`. But the reference implementation (`circlefin/arc-nanopayments` → `lib/x402.ts` `withGateway`) and the `@circle-fin/x402-batching` helper default to **`maxTimeoutSeconds: 345600` (4 days)** — below the floor — so a fresh build that copies the reference is rejected at settle.

**Fix we shipped (works):** set `maxTimeoutSeconds: 691200` (8 days, headroom over the 7-day floor):
```ts
// lib/paywall.ts — buildPaymentRequirements
maxTimeoutSeconds: 691_200,  // (+600 client window) > 604800 Gateway minValiditySeconds
```

**Suggested fixes for Circle:**
1. Bump the default `maxTimeoutSeconds` in the `@circle-fin/x402-batching` helper and the `arc-nanopayments` reference to ≥ `604800` (ideally with headroom), so the happy path works out of the box.
2. Surface the `minValiditySeconds` requirement **at the 402 challenge / `verify` step**, not only at `settle` — a too-short window should fail early with a clear message, not after the buyer has signed.
3. Echo the live `minValiditySeconds` from `/v1/x402/supported` in the docs next to the helper default (they currently disagree).

**Impact:** Without this, every developer who starts from the reference repo hits a late, terse failure on their first paid request. High-friction first-run experience. (A standalone GitHub issue for `circlefin/arc-nanopayments` is drafted at `docs/feedback/arc-nanopayments-validity-window-issue.md`.)

---

## 2. [DX · footgun] USDC's dual decimals (6 as ERC-20, 18 as native gas) is easy to get wrong

On Arc, USDC is **6 decimals as an ERC-20** but the **native gas token at 18 decimals**. In one agent we fund gas with `parseEther("0.01")` (18) and transfer spendable USDC with `parseUnits(amount, 6)` (6) — correct, but only after we got it wrong once. A mismatch is a silent 10^12 error.

**Suggested:** a first-class helper or clearly-named constants in the SDK (e.g. `usdcErc20(amount)` vs `usdcGas(amount)`), and a prominent callout in the Arc/Gateway docs. The dual-decimal rule deserves to be impossible to miss.

---

## 3. [DX · discoverability] Assembling the `GatewayWalletBatched` `extra` from magic values was non-obvious

The batched scheme requires an exact `extra` block:
```ts
extra: {
  name: "GatewayWalletBatched",
  version: "1",
  verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", // Arc Gateway Wallet
}
```
plus the CAIP network id `eip155:5042002` and the USDC asset address `0x3600…0000`. These were scattered to assemble correctly. A single canonical, copy-pasteable "Arc Testnet x402/Gateway constants" reference (or SDK-exported constants like `ARC_TESTNET.gatewayWallet`) would remove a class of setup errors. `/v1/x402/supported` helps but isn't surfaced in the quickstart.

---

## 4. [DX · errors] Settle-time errors are terse and arrive late

Several failure modes (the validity window above; an unfunded/under-deposited Gateway balance) only show up at `settle()` with short reason strings (`authorization_validity_too_short`, etc.). Because the buyer has already signed by then, debugging means re-running the whole 402→sign→settle loop. Earlier validation (at `verify`) and error messages that name the exact constraint + current vs required value would shorten the loop a lot.

---

## 5. [Positive] Gateway batching makes the core promise real

Credit where due: once past setup, **Gateway batching genuinely makes sub-cent pricing work** — our fleet evaluates and pays for articles at `$0.002–$0.005` and the per-payment economics close because settlement is amortized. USDC-as-native-gas is the right call. The `GatewayWalletBatched` scheme is the thing that made this build worth doing on Arc specifically.

---

## Environment
- `@circle-fin/x402-batching@^2.0.4`, `@x402/core@^2.6.0`, `@x402/evm@^2.6.0`
- Next.js 16, Node ≥ 25, viem ^2.47
- Arc Testnet: `eip155:5042002` (chainId 5042002), USDC `0x3600000000000000000000000000000000000000`, Gateway Wallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`, CCTP domain 26
- Repo: PressPay (this repository)

*Wave-1 captured 2026-06-17. Wave-2 (Circle CLI / Agent Wallets / Skills / MCP) to follow before the submission deadline.*
