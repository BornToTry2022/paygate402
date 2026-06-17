import { NextRequest, NextResponse } from "next/server";
import { loadPolicy, savePolicy, DEFAULT_POLICY } from "@/lib/guardrail/policy";
import { validatePolicyPatch } from "@/lib/guardrail/validate";
import { isAdminAuthorized, adminUnauthorized } from "@/lib/guardrail/admin-auth";

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return adminUnauthorized();
  const merchantId = req.nextUrl.searchParams.get("merchantId") ?? "press";
  return NextResponse.json(await loadPolicy(merchantId));
}

export async function PUT(req: NextRequest) {
  if (!isAdminAuthorized(req)) return adminUnauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const result = validatePolicyPatch(body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  const { merchantId } = result.patch;
  const merged = { ...DEFAULT_POLICY, ...(await loadPolicy(merchantId)), ...result.patch, merchantId };
  await savePolicy(merged);
  return NextResponse.json(merged);
}
