import { promises as fs } from "node:fs";
import path from "node:path";

/** A per-merchant spend policy GuardRail enforces before settlement. */
export interface GuardRailPolicy {
  merchantId: string;
  /** When false, the gate is a no-op (allow everything). */
  enabled: boolean;
  /** Lowercased payer/agent addresses allowed to pay; empty array = allow all. */
  allowlist: string[];
  /** Max total USD an agent may spend at this merchant per UTC day. */
  dailyCapUsd: number;
  /** Rate limit: at most `maxCount` payments per `windowMs` per agent. */
  velocity: { maxCount: number; windowMs: number };
  /** Per-tx cap scales linearly from baseCapUsd (score 0) to maxCapUsd (score >= atScore). */
  reputationScaling: { baseCapUsd: number; maxCapUsd: number; atScore: number };
  /** Per-tx USD amount above which the payment is escalated to a human. */
  humanApprovalThresholdUsd: number;
}

export const DEFAULT_POLICY: GuardRailPolicy = {
  merchantId: "",
  enabled: false,
  allowlist: [],
  dailyCapUsd: 1.0,
  velocity: { maxCount: 20, windowMs: 10_000 },
  reputationScaling: { baseCapUsd: 0.01, maxCapUsd: 0.1, atScore: 80 },
  humanApprovalThresholdUsd: 0.25,
};

const FILE = path.join(process.cwd(), ".data", "policies.json");

async function readAll(): Promise<Record<string, GuardRailPolicy>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf-8")) as Record<string, GuardRailPolicy>;
  } catch {
    return {};
  }
}

export async function loadPolicy(merchantId: string): Promise<GuardRailPolicy> {
  const all = await readAll();
  return all[merchantId] ?? { ...DEFAULT_POLICY, merchantId };
}

export async function savePolicy(policy: GuardRailPolicy): Promise<void> {
  const all = await readAll();
  all[policy.merchantId] = policy;
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2));
}
