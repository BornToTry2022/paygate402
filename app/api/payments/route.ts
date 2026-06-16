import { NextResponse } from "next/server";
import { getStats, listPayments } from "@/lib/store";
import { getReputation } from "@/lib/reputation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Seller's own revenue data for the dashboard (not paywalled). */
export async function GET() {
  const [stats, payments] = await Promise.all([getStats(), listPayments(100)]);
  const latestAgentId = payments.find((p) => p.agentId)?.agentId ?? null;
  const reputation = latestAgentId ? await getReputation(latestAgentId) : null;
  return NextResponse.json({ stats, payments, reputation });
}
