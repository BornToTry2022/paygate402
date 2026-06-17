import { NextResponse } from "next/server";
import { withPaywall } from "@/lib/paywall";

export const POST = withPaywall(
  async () => NextResponse.json({ ok: true, secret: "guardrail demo payload" }),
  "$0.003",
  "/api/premium/guarded",
  { guardrail: { merchantId: "press" } },
);
