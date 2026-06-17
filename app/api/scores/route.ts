import { NextRequest, NextResponse } from "next/server";
import { listScores } from "@/lib/agentscore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Free ranked KYA feed for the explorer (browsing is free; programmatic per-agent lookups are paywalled). */
export async function GET(req: NextRequest) {
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(200, Number(limitParam) || 50)) : undefined;
  return NextResponse.json({ scores: await listScores({ limit }) });
}
