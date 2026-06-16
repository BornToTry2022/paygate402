import { NextRequest, NextResponse } from "next/server";
import { withPaywall } from "@/lib/paywall";
import { keywords } from "@/lib/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { text: string, k?: number } -> { keywords: [{ term, count }] }
const handler = async (req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as { text?: string; k?: number };
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "Provide { text }" }, { status: 400 });
  }
  return NextResponse.json({
    keywords: keywords(text, Math.min(Math.max(body.k ?? 8, 1), 25)),
    input_chars: text.length,
    timestamp: new Date().toISOString(),
  });
};

export const POST = withPaywall(handler, "$0.001", "/api/premium/keywords");
