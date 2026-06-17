# GitHub issue draft — circlefin/arc-nanopayments

Copy-paste-ready. File at: https://github.com/circlefin/arc-nanopayments/issues/new

> **Before filing — quick checks (1 min):**
> 1. Search existing issues for "authorization_validity_too_short" / "345600" / "validity" to avoid a duplicate (link it if found).
> 2. Confirm the current default in the repo you're filing against (the value below was observed via `@circle-fin/x402-batching@^2.0.4` and the reference `lib/x402.ts withGateway`); if the latest `main`/SDK already bumped it, switch the issue to a quick "thanks, confirmed fixed in vX" or note your installed version.

---

**Title:**
`withGateway` default `maxTimeoutSeconds: 345600` is below Gateway's `minValiditySeconds` (604800) → settle fails with `authorization_validity_too_short`

**Labels (suggested):** bug, good first issue, dx

**Body:**

### Summary
The reference `withGateway` flow (and the `@circle-fin/x402-batching` helper default) build the EIP-3009 authorization validity window from `maxTimeoutSeconds = 345600` (4 days). Gateway testnet requires `minValiditySeconds = 604800` (7 days, per `/v1/x402/supported`). Since the client builds the window as `(maxTimeoutSeconds + 600)`, the default is below the floor and **settlement fails** with `authorization_validity_too_short`. A developer copying the reference hits this on their first paid request.

### Repro
1. Set up a paywalled route using the reference `withGateway` / `@circle-fin/x402-batching@^2.0.4` defaults (don't override `maxTimeoutSeconds`).
2. Make a buyer pay it via the `GatewayWalletBatched` scheme on Arc Testnet (`eip155:5042002`).
3. The 402 challenge and `verify` look OK; `facilitator.settle()` rejects.

### Expected
A fresh build from the reference settles successfully out of the box.

### Actual
`settle()` returns `authorization_validity_too_short`. The error only appears at settle time — after the buyer has already signed — which makes it hard to diagnose.

### Root cause
- Gateway `minValiditySeconds` (from `/v1/x402/supported`) is currently **604800**.
- Reference/helper default `maxTimeoutSeconds` is **345600**; window = `maxTimeoutSeconds + 600 = 346200 < 604800`.

### Suggested fix
1. Bump the default `maxTimeoutSeconds` in `withGateway` (and the `@circle-fin/x402-batching` helper) to ≥ `604800`, ideally with headroom (we use `691200` = 8 days and it works).
2. Validate the window against `minValiditySeconds` at the **402 challenge / `verify`** step and fail early with a message that names the required vs provided seconds — not only at `settle`.
3. Keep the helper default in sync with `/v1/x402/supported` (or read it dynamically) so the two can't drift.

### Workaround (confirmed working)
Override the default:
```ts
// buildPaymentRequirements
maxTimeoutSeconds: 691_200, // (+600 client window) > 604800 Gateway minValiditySeconds
```

### Environment
- `@circle-fin/x402-batching@^2.0.4`, `@x402/core@^2.6.0`, `@x402/evm@^2.6.0`
- Arc Testnet `eip155:5042002`, Gateway Wallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`, USDC `0x3600000000000000000000000000000000000000`
