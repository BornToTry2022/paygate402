import { NextRequest, NextResponse } from "next/server";
import { resolveApproval } from "@/lib/guardrail/approvals";
import { isAdminAuthorized, adminUnauthorized } from "@/lib/guardrail/admin-auth";

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return adminUnauthorized();
  let body: { id?: string; approve?: boolean };
  try {
    body = (await req.json()) as { id?: string; approve?: boolean };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.id !== "string") return NextResponse.json({ error: "id required" }, { status: 400 });
  const resolved = await resolveApproval(body.id, Boolean(body.approve));
  if (!resolved) return NextResponse.json({ error: "approval not found" }, { status: 404 });
  return NextResponse.json(resolved);
}
