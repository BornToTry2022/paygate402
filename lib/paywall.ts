import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import { NextRequest, NextResponse } from "next/server";
import { ARC, getSellerAddress } from "@/lib/arc";
import { recordPayment } from "@/lib/store";
import { getReputation } from "@/lib/reputation";
import { verifyAgentControl } from "@/lib/agentauth";
import { guardrailGate } from "@/lib/guardrail/gate";
import { guardrailResponseFor } from "@/lib/guardrail/engine";
import { enqueueApproval } from "@/lib/guardrail/approvals";

/**
 * withPaywall — wrap any Next.js route handler so it requires an x402 USDC
 * nanopayment on Arc before running.
 *
 * This is a reusable, store-agnostic refactor of the reference implementation in
 * circlefin/arc-nanopayments (lib/x402.ts `withGateway`). The Arc-specific magic
 * is the `extra: { name: "GatewayWalletBatched", ... }` field: it tells the buyer
 * to sign an offchain authorization that Circle Gateway batches into a single
 * onchain settlement — which is what makes sub-cent ($0.000001+) pricing viable.
 *
 *   export const POST = withPaywall(handler, "$0.002", "/api/premium/summarize");
 */

const facilitator = new BatchFacilitatorClient();

interface PaymentPayload {
  x402Version: number;
  resource?: { url: string; description: string; mimeType: string };
  accepted?: Record<string, unknown>;
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

function buildPaymentRequirements(price: string, payTo: `0x${string}`) {
  // "$0.002" -> 2000 atomic units (USDC has 6 decimals).
  const amount = Math.round(parseFloat(price.replace("$", "")) * 1_000_000);
  return {
    scheme: "exact" as const,
    network: ARC.network,
    asset: ARC.usdc,
    amount: amount.toString(),
    payTo,
    // Gateway-testnet requires the EIP-3009 authorization to stay valid for at least
    // minValiditySeconds (currently 604800 = 7 days; see /v1/x402/supported). The client
    // builds the window as (maxTimeoutSeconds + 600), so we use 8 days for headroom.
    // NOTE: the reference repo and even the SDK helper still ship the stale 345600 (4 days),
    // which Gateway now rejects with "authorization_validity_too_short".
    maxTimeoutSeconds: 691_200,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: ARC.gatewayWallet,
    },
  };
}

type Handler = (req: NextRequest) => Promise<NextResponse> | NextResponse;

export interface PaywallOpts {
  /** Deny access (HTTP 403) unless the calling agent's ERC-8004 reputation score >= minScore. */
  minScore?: number;
  /** Charge a discounted price to agents whose reputation score >= atScore. */
  discount?: { atScore: number; price: string };
  /** Enable GuardRail spend-policy enforcement for this endpoint, scoped to a merchant id. */
  guardrail?: { merchantId: string };
}

export function withPaywall(
  handler: Handler,
  price: string,
  endpoint: string,
  opts: PaywallOpts = {},
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const sellerAddress = getSellerAddress();
    if (!sellerAddress) {
      return NextResponse.json(
        { error: "SELLER_ADDRESS not configured. Run `npm run generate-wallets`." },
        { status: 500 },
      );
    }

    // Only trust the claimed identity if the caller proves control of it: an
    // `X-Agent-Signature` over a timestamped message, verified against the agent's
    // on-chain owner. A bare `X-Agent-Id` is spoofable, so unverified/spoofed ids
    // fall through to anonymous (full price, gated endpoints denied).
    const agentId = await verifyAgentControl(
      req.headers.get("x-agent-id"),
      req.headers.get("x-agent-signature"),
      req.headers.get("x-agent-timestamp"),
    );
    const agentAddress = agentId ? req.headers.get("x-agent-address") : null;

    // --- ERC-8004 reputation gate / dynamic pricing (read on both the 402 and the paid retry;
    // getReputation is cached so both compute the same effective price) ---
    let effectivePrice = price;
    if (opts.minScore != null || opts.discount) {
      const rep = await getReputation(agentId);
      if (opts.minScore != null && rep.score < opts.minScore) {
        return NextResponse.json(
          {
            error: "reputation gate",
            endpoint,
            requiredScore: opts.minScore,
            yourScore: rep.score,
            agentId: agentId ?? null,
            hint: agentId
              ? "Build ERC-8004 reputation (seller feedback) to unlock this endpoint."
              : "Present a verified ERC-8004 identity (X-Agent-Signature) with sufficient reputation to access this endpoint.",
          },
          { status: 403 },
        );
      }
      if (opts.discount && rep.score >= opts.discount.atScore) effectivePrice = opts.discount.price;
    }

    const requirements = buildPaymentRequirements(effectivePrice, sellerAddress);
    const paymentSignature = req.headers.get("payment-signature");

    // --- No payment: return 402 with Gateway batching requirements ---
    if (!paymentSignature) {
      const paymentRequired = {
        x402Version: 2,
        resource: {
          url: endpoint,
          description: `Paid resource (${effectivePrice} USDC)`,
          mimeType: "application/json",
        },
        accepts: [requirements],
      };
      return new NextResponse(
        JSON.stringify({ error: "Payment required", price: effectivePrice, endpoint }),
        {
        status: 402,
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(paymentRequired)).toString("base64"),
        },
      });
    }

    // --- Payment present: verify + settle via Circle Gateway, then serve ---
    try {
      const payload: PaymentPayload = JSON.parse(
        Buffer.from(paymentSignature, "base64").toString("utf-8"),
      );

      const verifyResult = await facilitator.verify(payload, requirements);
      if (!verifyResult.isValid) {
        console.error(`[paywall] verify failed (${endpoint}): ${verifyResult.invalidReason}`);
        return NextResponse.json(
          { error: "Payment verification failed", reason: verifyResult.invalidReason },
          { status: 402 },
        );
      }

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

      const settleResult = await facilitator.settle(payload, requirements);
      if (!settleResult.success) {
        return NextResponse.json(
          { error: "Payment settlement failed", reason: settleResult.errorReason },
          { status: 402 },
        );
      }

      const amountUsdc = (Number(requirements.amount) / 1e6).toString();
      const payer = settleResult.payer ?? verifyResult.payer ?? "unknown";

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

      console.log(`[paywall] settled ${endpoint} — ${amountUsdc} USDC from ${payer}`);

      const response = await handler(req);
      response.headers.set(
        "PAYMENT-RESPONSE",
        Buffer.from(
          JSON.stringify({
            success: true,
            transaction: settleResult.transaction,
            network: requirements.network,
            payer,
          }),
        ).toString("base64"),
      );
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[paywall] payment processing error:", message);
      return NextResponse.json({ error: "Payment processing error", message }, { status: 500 });
    }
  };
}
