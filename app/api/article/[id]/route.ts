import { NextRequest, NextResponse } from "next/server";
import { getArticleMeta, getArticleBody } from "@/lib/articles";
import { withPaywall } from "@/lib/paywall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  const meta = getArticleMeta(id);
  if (!meta) return NextResponse.json({ error: "no such article" }, { status: 404 });

  // Build the paywall at the article's own price, then run it for this request.
  const gated = withPaywall(
    async () => NextResponse.json({ id, title: meta.title, body: getArticleBody(id) }),
    `$${meta.priceUsd}`,
    `/api/article/${id}`,
  );
  return gated(req);
}
