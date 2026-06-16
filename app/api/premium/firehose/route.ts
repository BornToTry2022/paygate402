import { NextRequest, NextResponse } from "next/server";
import { withPaywall } from "@/lib/paywall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * High-frequency tick feed — cheap per call ($0.0001), meant to be polled fast.
 * REPUTATION-GATED: only agents whose ERC-8004 reputation score >= 60 may call it.
 * Anonymous or low-reputation agents get HTTP 403 (no payment accepted).
 */
const handler = async (_req: NextRequest) => {
  const now = Date.now();
  return NextResponse.json({
    tick: now,
    seq: Math.floor(now / 250), // a fast-moving sequence number
    serverTime: new Date(now).toISOString(),
  });
};

export const GET = withPaywall(handler, "$0.0001", "/api/premium/firehose", { minScore: 60 });
