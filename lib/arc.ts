import { createPublicClient, http } from "viem";
import { arcTestnet } from "viem/chains";

/**
 * Arc Testnet constants. These are stable, verified values.
 * Note the dual-decimal rule: USDC is 6 decimals as an ERC-20, but 18 decimals
 * when used as native gas. Always be explicit about which you mean.
 */
export const ARC = {
  /** CAIP-2 network id used by x402 / Circle Gateway. */
  network: "eip155:5042002" as const,
  chainId: 5042002,
  rpc: "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
  /** USDC: ERC-20 (6 decimals) and the native gas token (18 decimals). */
  usdc: "0x3600000000000000000000000000000000000000" as `0x${string}`,
  /** Circle Gateway Wallet — the verifyingContract for the GatewayWalletBatched scheme. */
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as `0x${string}`,
  cctpDomain: 26,
} as const;

/** Seller address that receives USDC. Read at request time (may be unset at build time). */
export function getSellerAddress(): `0x${string}` | undefined {
  const a = process.env.SELLER_ADDRESS;
  return a && a.startsWith("0x") ? (a as `0x${string}`) : undefined;
}

/** Shared read-only client for balance lookups etc. */
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC.rpc),
});
