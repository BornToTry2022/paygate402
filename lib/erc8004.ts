/**
 * ERC-8004 (Trustless Agents) on-chain identity on Arc Testnet.
 *
 * The IdentityRegistry mints an ERC-721 "agent identity" NFT. `register(agentURI)`
 * returns the new agentId and emits both a `Registered` event and a standard ERC-721
 * `Transfer(0x0 -> owner, tokenId)`. We read the agentId from the Transfer event.
 *
 * Verified registries (Arc Testnet):
 *   IdentityRegistry   0x8004A818BFB912233c491871b3d84c89A494BD9e (impl 0x7274e874…)
 *   ReputationRegistry 0x8004B663056A597Dffe9eCcC1965A193B7388713
 *   ValidationRegistry 0x8004Cb1BF31DAf7788923b405b754f57acEB4272
 */

export const ERC8004 = {
  identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e" as `0x${string}`,
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713" as `0x${string}`,
  validationRegistry: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272" as `0x${string}`,
} as const;

/** Minimal IdentityRegistry ABI (subset we use), from the verified implementation. */
export const identityRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

/** Explorer link to an agent identity NFT instance. */
export function agentExplorerUrl(agentId: string | number | bigint): string {
  return `https://testnet.arcscan.app/token/${ERC8004.identityRegistry}/instance/${agentId}`;
}
