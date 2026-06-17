import { NextRequest, NextResponse } from "next/server";
import { loadPolicy, savePolicy, DEFAULT_POLICY, type GuardRailPolicy } from "@/lib/guardrail/policy";

export async function GET(req: NextRequest) {
  const merchantId = req.nextUrl.searchParams.get("merchantId") ?? "press";
  return NextResponse.json(await loadPolicy(merchantId));
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as Partial<GuardRailPolicy> & { merchantId?: string };
  const merchantId = body.merchantId ?? "press";
  const merged: GuardRailPolicy = { ...DEFAULT_POLICY, ...(await loadPolicy(merchantId)), ...body, merchantId };
  await savePolicy(merged);
  return NextResponse.json(merged);
}
