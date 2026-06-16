import { NextRequest, NextResponse } from "next/server";
import { withPaywall } from "@/lib/paywall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET -> indicative USDC<->EURC rate.
 *
 * NOTE: this is an INDICATIVE mock (deterministic oscillation, no external feed) so
 * the endpoint runs with zero dependencies. For a real quote, wire this to Arc's
 * native StableFX RFQ + on-chain PvP settlement via FxEscrow
 * (0x867650F5eAe8df91445971f14d89fd84F0C9a9f8) — see developers.circle.com/stablefx.
 */
const handler = async (_req: NextRequest) => {
  const minutes = Math.floor(Date.now() / 60_000);
  // Base ~0.92 EUR per USDC with a small, smooth, deterministic wobble.
  const eurPerUsdc = 0.92 + 0.01 * Math.sin(minutes / 30);
  const round = (n: number) => Math.round(n * 1e6) / 1e6;

  return NextResponse.json({
    base: "USDC",
    quote: "EURC",
    rate: round(eurPerUsdc),
    inverse: round(1 / eurPerUsdc),
    source: "indicative-mock",
    note: "Indicative only. Replace with Arc StableFX RFQ + FxEscrow for executable quotes.",
    timestamp: new Date().toISOString(),
  });
};

export const GET = withPaywall(handler, "$0.0005", "/api/premium/fx-rate");
