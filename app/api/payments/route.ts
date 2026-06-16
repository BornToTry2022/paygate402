import { NextResponse } from "next/server";
import { getStats, listPayments } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Seller's own revenue data for the dashboard (not paywalled). */
export async function GET() {
  const [stats, payments] = await Promise.all([getStats(), listPayments(100)]);
  return NextResponse.json({ stats, payments });
}
