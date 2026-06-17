import { NextRequest, NextResponse } from "next/server";
import { withPaywall } from "@/lib/paywall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tip the creator any amount: GET /api/tip?amount=0.01 — paywalled at the requested amount. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const raw = Number(req.nextUrl.searchParams.get("amount"));
  const amount = Number.isFinite(raw) && raw > 0 && raw <= 100 ? Math.round(raw * 1e6) / 1e6 : 0.01;
  const gated = withPaywall(
    async () => NextResponse.json({ ok: true, tipped: amount }),
    `$${amount}`,
    `/api/tip`,
  );
  return gated(req);
}
