/**
 * Seller gives ERC-8004 reputation feedback to the buyer agent on Arc Testnet.
 *
 *   npm run give-feedback                 # score 80 (default)
 *   npm run give-feedback -- --score 90
 *
 * The SELLER acts as the reviewer/client. ERC-8004 forbids an identity owner from
 * rating its own agent, so this MUST be a different wallet than the agent owner —
 * which the seller is. The seller earns USDC via Gateway (off-chain), so it may have
 * no native gas; we top it up from BUYER if needed (demo convenience).
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ERC8004, reputationRegistryAbi, agentExplorerUrl } from "../lib/erc8004.ts";

const RPC = "https://rpc.testnet.arc.network";
const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

const argv = process.argv.slice(2);
const scoreArg = argv.indexOf("--score");
const score = scoreArg >= 0 ? Number(argv[scoreArg + 1]) : 80;
if (isNaN(score) || score < 0 || score > 100) {
  console.error("--score must be 0..100");
  process.exit(1);
}

const agentId = process.env.AGENT_ID;
if (!agentId) {
  console.error("Missing AGENT_ID. Run `npm run register-agent` first.");
  process.exit(1);
}
const sellerKey = process.env.SELLER_PRIVATE_KEY as `0x${string}`;
if (!sellerKey) {
  console.error("Missing SELLER_PRIVATE_KEY.");
  process.exit(1);
}

const seller = privateKeyToAccount(sellerKey);
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
const sellerWallet = createWalletClient({ account: seller, chain: arcTestnet, transport: http(RPC) });

// Ensure the seller has native gas (USDC, 18-decimal) to send the tx.
const sellerGas = await publicClient.getBalance({ address: seller.address });
if (sellerGas < parseEther("0.02")) {
  const buyerKey = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!buyerKey) {
    console.error(`Seller ${seller.address} has no gas and BUYER_PRIVATE_KEY is unset to top it up.`);
    process.exit(1);
  }
  const buyer = privateKeyToAccount(buyerKey);
  const buyerWallet = createWalletClient({ account: buyer, chain: arcTestnet, transport: http(RPC) });
  console.log(`Seller low on gas (${formatEther(sellerGas)} USDC) — topping up 0.1 from BUYER...`);
  const h = await buyerWallet.sendTransaction({ to: seller.address, value: parseEther("0.1") });
  await publicClient.waitForTransactionReceipt({ hash: h });
  console.log(`  funded (${h.slice(0, 10)}...)`);
}

console.log(`Seller ${seller.address}\n  gives feedback to agent #${agentId}: score ${score}/100`);
const hash = await sellerWallet.writeContract({
  address: ERC8004.reputationRegistry,
  abi: reputationRegistryAbi,
  functionName: "giveFeedback",
  // (agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)
  args: [BigInt(agentId), BigInt(score), 0, "reliability", "", "paygate402", "", ZERO32],
});
console.log(`  tx: ${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`  mined in block ${receipt.blockNumber}`);

const clients = (await publicClient.readContract({
  address: ERC8004.reputationRegistry,
  abi: reputationRegistryAbi,
  functionName: "getClients",
  args: [BigInt(agentId)],
})) as readonly `0x${string}`[];
const [count, summaryValue, decimals] = (await publicClient.readContract({
  address: ERC8004.reputationRegistry,
  abi: reputationRegistryAbi,
  functionName: "getSummary",
  args: [BigInt(agentId), clients, "", ""],
})) as readonly [bigint, bigint, number];

console.log(`\n✅ Feedback recorded.`);
console.log(`   getSummary -> count=${count}, summaryValue=${summaryValue}, decimals=${decimals}`);
console.log(`   aggregate score = ${Number(summaryValue) / 10 ** Number(decimals)} / 100`);
console.log(`   identity: ${agentExplorerUrl(agentId)}`);
console.log(`   tx:       https://testnet.arcscan.app/tx/${hash}`);
console.log(`\nThe seller's paywall reflects this within ~30s (reputation cache TTL).`);
