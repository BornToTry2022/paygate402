import { NextResponse } from "next/server";
import { getStats, listPayments, getTractionBreakdown } from "@/lib/store";
import { getReputation } from "@/lib/reputation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Which payers count as the project's own dogfood (so the dashboard can separate
// genuine external traction). Defaults to the fleet's ERC-8004 agent + own wallets;
// override with SELF_AGENT_IDS / SELF_ADDRESSES (comma-separated) if needed.
const SELF_AGENT_IDS = (process.env.SELF_AGENT_IDS ?? process.env.AGENT_ID ?? "668408")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const SELF_ADDRS = (
  process.env.SELF_ADDRESSES ??
  [process.env.BUYER_ADDRESS, process.env.SELLER_ADDRESS].filter(Boolean).join(",")
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Seller's own revenue data for the dashboard (not paywalled). */
export async function GET() {
  const [stats, payments, traction] = await Promise.all([
    getStats(),
    listPayments(100),
    getTractionBreakdown({ selfAgentIds: SELF_AGENT_IDS, selfAddrs: SELF_ADDRS }),
  ]);
  const latestAgentId = payments.find((p) => p.agentId)?.agentId ?? null;
  const reputation = latestAgentId ? await getReputation(latestAgentId) : null;
  return NextResponse.json({ stats, payments, reputation, traction });
}
