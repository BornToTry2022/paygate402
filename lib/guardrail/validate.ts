const MERCHANT_RE = /^[a-z0-9_-]{1,64}$/;
const MERCHANT_BLOCKLIST = new Set(["__proto__", "constructor", "prototype"]);
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/** A validated, whitelisted policy patch — only fields an operator may write. */
export type PolicyPatch = {
  merchantId: string;
  enabled?: boolean;
  dailyCapUsd?: number;
  humanApprovalThresholdUsd?: number;
  allowlist?: string[];
  velocity?: { maxCount: number; windowMs: number };
  reputationScaling?: { baseCapUsd: number; maxCapUsd: number; atScore: number };
};

type Result = { ok: true; patch: PolicyPatch } | { ok: false; error: string };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const inRange = (v: unknown, max: number): v is number => finite(v) && v >= 0 && v <= max;
const posInt = (v: unknown, max: number): v is number =>
  finite(v) && Number.isInteger(v) && v >= 1 && v <= max;

/**
 * Validate an untrusted policy-patch body. Returns a whitelisted patch containing
 * ONLY known, in-bounds fields (no blanket spread → no mass-assignment), with a
 * charset-checked merchantId (rejects __proto__/constructor/path chars).
 */
export function validatePolicyPatch(body: unknown): Result {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  const merchantId = b.merchantId === undefined ? "press" : b.merchantId;
  if (typeof merchantId !== "string" || !MERCHANT_RE.test(merchantId) || MERCHANT_BLOCKLIST.has(merchantId)) {
    return { ok: false, error: "merchantId must match [a-z0-9_-]{1,64}" };
  }
  const patch: PolicyPatch = { merchantId };

  if (b.enabled !== undefined) {
    if (typeof b.enabled !== "boolean") return { ok: false, error: "enabled must be boolean" };
    patch.enabled = b.enabled;
  }
  if (b.dailyCapUsd !== undefined) {
    if (!inRange(b.dailyCapUsd, 1_000_000)) return { ok: false, error: "dailyCapUsd must be 0..1000000" };
    patch.dailyCapUsd = b.dailyCapUsd;
  }
  if (b.humanApprovalThresholdUsd !== undefined) {
    if (!inRange(b.humanApprovalThresholdUsd, 1_000_000)) return { ok: false, error: "humanApprovalThresholdUsd must be 0..1000000" };
    patch.humanApprovalThresholdUsd = b.humanApprovalThresholdUsd;
  }
  if (b.allowlist !== undefined) {
    if (!Array.isArray(b.allowlist) || !b.allowlist.every((a) => typeof a === "string" && ADDR_RE.test(a))) {
      return { ok: false, error: "allowlist must be an array of 0x addresses" };
    }
    patch.allowlist = (b.allowlist as string[]).map((a) => a.toLowerCase());
  }
  if (b.velocity !== undefined) {
    const v = b.velocity as Record<string, unknown>;
    if (typeof v !== "object" || v === null) return { ok: false, error: "velocity must be an object" };
    if (!posInt(v.maxCount, 1_000_000)) return { ok: false, error: "velocity.maxCount must be a positive integer" };
    if (!posInt(v.windowMs, 1_000_000_000)) return { ok: false, error: "velocity.windowMs must be a positive integer" };
    patch.velocity = { maxCount: v.maxCount, windowMs: v.windowMs };
  }
  if (b.reputationScaling !== undefined) {
    const r = b.reputationScaling as Record<string, unknown>;
    if (typeof r !== "object" || r === null) return { ok: false, error: "reputationScaling must be an object" };
    if (!inRange(r.baseCapUsd, 1_000_000) || !inRange(r.maxCapUsd, 1_000_000) || !inRange(r.atScore, 1_000_000)) {
      return { ok: false, error: "reputationScaling fields must be 0..1000000" };
    }
    patch.reputationScaling = { baseCapUsd: r.baseCapUsd, maxCapUsd: r.maxCapUsd, atScore: r.atScore };
  }

  return { ok: true, patch };
}
