import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Optional admin gate for GuardRail admin routes.
 * - GUARDRAIL_ADMIN_TOKEN unset  → open mode (local/demo): every request authorized.
 * - GUARDRAIL_ADMIN_TOKEN set    → require `Authorization: Bearer <token>` (constant-time compare).
 * Bearer-header auth (not cookies) → CSRF does not apply.
 */
export function isAdminAuthorized(req: NextRequest): boolean {
  const expected = process.env.GUARDRAIL_ADMIN_TOKEN;
  if (!expected) return true; // open demo mode
  const header = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length));
  const want = Buffer.from(expected);
  if (provided.length !== want.length) return false;
  return timingSafeEqual(provided, want);
}

export function adminUnauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
