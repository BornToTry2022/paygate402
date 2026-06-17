import { NextResponse } from "next/server";
import { getJobsAndStats } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ERC-8183 agent-to-agent jobs for the dashboard (not paywalled). */
export async function GET() {
  // One file read → list and stats are always a consistent snapshot.
  return NextResponse.json(await getJobsAndStats(50));
}
