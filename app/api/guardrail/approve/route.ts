import { NextRequest, NextResponse } from "next/server";
import { resolveApproval } from "@/lib/guardrail/approvals";

export async function POST(req: NextRequest) {
  const { id, approve } = (await req.json()) as { id: string; approve: boolean };
  const resolved = await resolveApproval(id, Boolean(approve));
  if (!resolved) return NextResponse.json({ error: "approval not found" }, { status: 404 });
  return NextResponse.json(resolved);
}
