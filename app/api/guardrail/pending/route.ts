import { NextResponse } from "next/server";
import { listPending } from "@/lib/guardrail/approvals";

export async function GET() {
  return NextResponse.json(await listPending());
}
