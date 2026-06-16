import { publicClient } from "@/lib/arc";
import { ERC8004, reputationRegistryAbi } from "@/lib/erc8004";

/**
 * Reads an agent's aggregate reputation from the ERC-8004 ReputationRegistry.
 * Cached briefly so the paywall can consult it on every request without an RPC
 * round-trip each time.
 */

export interface Reputation {
  agentId: string;
  /** Number of feedback entries aggregated. */
  count: number;
  /** Aggregate score (0–100), scaled by the registry's valueDecimals. */
  score: number;
}

const TTL_MS = 30_000;
const cache = new Map<string, { rep: Reputation; exp: number }>();

const EMPTY: Reputation = { agentId: "", count: 0, score: 0 };

export async function getReputation(agentId: string | null | undefined): Promise<Reputation> {
  if (!agentId) return EMPTY;
  const now = Date.now();
  const hit = cache.get(agentId);
  if (hit && hit.exp > now) return hit.rep;

  let rep: Reputation;
  try {
    // getSummary reverts on an empty client list, so fetch the agent's reviewers first.
    const clients = (await publicClient.readContract({
      address: ERC8004.reputationRegistry,
      abi: reputationRegistryAbi,
      functionName: "getClients",
      args: [BigInt(agentId)],
    })) as readonly `0x${string}`[];

    if (clients.length === 0) {
      rep = { agentId, count: 0, score: 0 };
    } else {
      const [count, summaryValue, decimals] = (await publicClient.readContract({
        address: ERC8004.reputationRegistry,
        abi: reputationRegistryAbi,
        functionName: "getSummary",
        args: [BigInt(agentId), clients, "", ""],
      })) as readonly [bigint, bigint, number];

      const value = Number(summaryValue) / 10 ** Number(decimals);
      rep = { agentId, count: Number(count), score: Math.round(value * 100) / 100 };
    }
  } catch {
    rep = { agentId, count: 0, score: 0 };
  }

  cache.set(agentId, { rep, exp: now + TTL_MS });
  return rep;
}

/** Clear the cache (e.g. right after new feedback is recorded). */
export function clearReputationCache(agentId?: string): void {
  if (agentId) cache.delete(agentId);
  else cache.clear();
}
