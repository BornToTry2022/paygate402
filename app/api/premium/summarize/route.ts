import { NextRequest, NextResponse } from "next/server";
import { withPaywall } from "@/lib/paywall";
import { llmSummarize, summarize } from "@/lib/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { text: string, maxSentences?: number } -> { summary, mode }
const handler = async (req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    text?: string;
    maxSentences?: number;
  };
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "Provide { text }" }, { status: 400 });
  }

  const useLlm = Boolean(process.env.OPENAI_API_KEY);
  const summary = useLlm ? await llmSummarize(text) : summarize(text, body.maxSentences ?? 3);

  return NextResponse.json({
    summary,
    mode: useLlm ? "llm" : "heuristic",
    input_chars: text.length,
    timestamp: new Date().toISOString(),
  });
};

export const POST = withPaywall(handler, "$0.002", "/api/premium/summarize");
