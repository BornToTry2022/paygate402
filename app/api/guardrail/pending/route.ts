import { NextRequest, NextResponse } from "next/server";
import { listPending } from "@/lib/guardrail/approvals";
import { isAdminAuthorized, adminUnauthorized } from "@/lib/guardrail/admin-auth";

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return adminUnauthorized();
  return NextResponse.json(await listPending());
}
