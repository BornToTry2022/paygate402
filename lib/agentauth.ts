import { recoverMessageAddress } from "viem";
import { publicClient } from "@/lib/arc";
import { ERC8004, identityRegistryAbi, agentControlMessage } from "@/lib/erc8004";

/**
 * Proof-of-control for an ERC-8004 agent identity.
 *
 * The `X-Agent-Id` header alone is spoofable — anyone could claim a reputable
 * agent's id to get its discount / unlock gated endpoints. So we only trust a
 * claimed id when the caller proves control of it: they sign a timestamped
 * message with the agent's owner (or registered) key, and we verify on-chain that
 * the recovered signer is `ownerOf(agentId)` or `getAgentWallet(agentId)`.
 *
 * Residual limitation: a captured signature can be replayed within MAX_AGE. A
 * production system should use a server-issued nonce (challenge-response). The
 * timestamp window keeps the demo stateless while closing the trivial spoof.
 */

const ZERO = "0x0000000000000000000000000000000000000000";
const MAX_AGE_SEC = 300;

const ZERO_ADDR = ZERO.toLowerCase();

// Cache the on-chain controllers of an agent (owner rarely changes).
const ctrlCache = new Map<string, { owner: string; agentWallet: string; exp: number }>();

async function getControllers(agentId: string): Promise<{ owner: string; agentWallet: string }> {
  const now = Date.now();
  const hit = ctrlCache.get(agentId);
  if (hit && hit.exp > now) return hit;

  let owner = "";
  let agentWallet = "";
  try {
    owner = (await publicClient.readContract({
      address: ERC8004.identityRegistry,
      abi: identityRegistryAbi,
      functionName: "ownerOf",
      args: [BigInt(agentId)],
    })) as string;
  } catch {
    /* unregistered / unreadable */
  }
  try {
    agentWallet = (await publicClient.readContract({
      address: ERC8004.identityRegistry,
      abi: identityRegistryAbi,
      functionName: "getAgentWallet",
      args: [BigInt(agentId)],
    })) as string;
  } catch {
    /* no registered wallet */
  }

  const rec = { owner, agentWallet, exp: now + 60_000 };
  ctrlCache.set(agentId, rec);
  return rec;
}

/**
 * Returns the agentId only if the caller proved control of it; otherwise null
 * (caller is treated as anonymous). Never trust the header without this.
 */
export async function verifyAgentControl(
  agentId: string | null,
  signature: string | null,
  timestamp: string | null,
): Promise<string | null> {
  if (!agentId || !signature || !timestamp) return null;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_AGE_SEC) return null;

  let signer: string;
  try {
    signer = await recoverMessageAddress({
      message: agentControlMessage(agentId, timestamp),
      signature: signature as `0x${string}`,
    });
  } catch {
    return null;
  }

  const { owner, agentWallet } = await getControllers(agentId);
  const s = signer.toLowerCase();
  if (owner && s === owner.toLowerCase()) return agentId;
  if (agentWallet && agentWallet.toLowerCase() !== ZERO_ADDR && s === agentWallet.toLowerCase()) {
    return agentId;
  }
  return null;
}
