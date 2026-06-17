import { NextRequest, NextResponse } from "next/server";
import { withPaywall } from "@/lib/paywall";
import { getScore } from "@/lib/agentscore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(req: NextRequest): Promise<NextResponse> {
  const agentId = req.nextUrl.searchParams.get("agentId");
  if (!agentId || !/^\d+$/.test(agentId)) {
    return NextResponse.json({ error: "numeric agentId query param required" }, { status: 400 });
  }
  return NextResponse.json(await getScore(agentId));
}

/** Pay $0.001 in USDC to read a specific agent's KYA score — AgentScore dogfooding the paywall. */
export const GET = withPaywall(handler, "$0.001", "/api/score");
