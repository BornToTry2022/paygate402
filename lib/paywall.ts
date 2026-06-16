import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import { NextRequest, NextResponse } from "next/server";
import { ARC, getSellerAddress } from "@/lib/arc";
import { recordPayment } from "@/lib/store";

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

export function withPaywall(handler: Handler, price: string, endpoint: string) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const sellerAddress = getSellerAddress();
    if (!sellerAddress) {
      return NextResponse.json(
        { error: "SELLER_ADDRESS not configured. Run `npm run generate-wallets`." },
        { status: 500 },
      );
    }

    const requirements = buildPaymentRequirements(price, sellerAddress);
    const paymentSignature = req.headers.get("payment-signature");

    // --- No payment: return 402 with Gateway batching requirements ---
    if (!paymentSignature) {
      const paymentRequired = {
        x402Version: 2,
        resource: {
          url: endpoint,
          description: `Paid resource (${price} USDC)`,
          mimeType: "application/json",
        },
        accepts: [requirements],
      };
      return new NextResponse(JSON.stringify({ error: "Payment required", price, endpoint }), {
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
        // Optional ERC-8004 identity the buyer agent presents about itself.
        agentId: req.headers.get("x-agent-id"),
        agentAddress: req.headers.get("x-agent-address"),
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
