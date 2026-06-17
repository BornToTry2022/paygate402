import { NextResponse } from "next/server";
import { listArticles } from "@/lib/articles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Free article catalogue (metadata + price, no bodies) — what the fleet reads to decide. */
export async function GET() {
  return NextResponse.json({ articles: listArticles() });
}
