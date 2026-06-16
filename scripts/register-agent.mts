/**
 * Register the buyer wallet as an ERC-8004 on-chain agent identity on Arc Testnet.
 *
 *   npm run register-agent          # mints an identity for BUYER_ADDRESS, writes AGENT_ID
 *   npm run register-agent -- --force   # register again even if AGENT_ID already set
 *
 * The agent's metadata (agent card) is served at /.well-known/agent-card.json; override
 * the URI with AGENT_METADATA_URI (e.g. an IPFS/HTTPS URL) for a non-local deployment.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  formatEther,
  zeroAddress,
} from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import fs from "node:fs";
import path from "node:path";
import { ERC8004, identityRegistryAbi, agentExplorerUrl } from "../lib/erc8004.ts";

const RPC = "https://rpc.testnet.arc.network";
const force = process.argv.slice(2).includes("--force");

if (process.env.AGENT_ID && !force) {
  console.log(
    `Agent already registered: #${process.env.AGENT_ID} (${process.env.AGENT_ADDRESS ?? "?"}).\n` +
      `Re-run with --force to mint another identity.`,
  );
  process.exit(0);
}

const key = process.env.BUYER_PRIVATE_KEY as `0x${string}`;
if (!key) {
  console.error("Missing BUYER_PRIVATE_KEY. Run `npm run generate-wallets` first.");
  process.exit(1);
}

const account = privateKeyToAccount(key);
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(RPC) });

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const agentURI = process.env.AGENT_METADATA_URI ?? `${baseUrl}/.well-known/agent-card.json`;

console.log(`Registering ERC-8004 identity for ${account.address}`);
console.log(`  registry:  ${ERC8004.identityRegistry}`);
console.log(`  agentURI:  ${agentURI}`);

// Preview agentId + catch reverts before spending gas.
const { result: predictedId, request } = await publicClient.simulateContract({
  account,
  address: ERC8004.identityRegistry,
  abi: identityRegistryAbi,
  functionName: "register",
  args: [agentURI],
});
console.log(`  predicted agentId: ${predictedId}`);

const hash = await wallet.writeContract(request);
console.log(`  tx: ${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`  mined in block ${receipt.blockNumber}, gas used ${receipt.gasUsed}`);

// Authoritative agentId = tokenId of the mint Transfer (0x0 -> owner).
const transfers = parseEventLogs({ abi: identityRegistryAbi, eventName: "Transfer", logs: receipt.logs });
const minted = transfers.find(
  (l) => l.args.from === zeroAddress && l.args.to.toLowerCase() === account.address.toLowerCase(),
);
const agentId = (minted?.args.tokenId ?? predictedId).toString();

// Confirm by reading back on-chain.
const [owner, uri] = await Promise.all([
  publicClient.readContract({
    address: ERC8004.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "ownerOf",
    args: [BigInt(agentId)],
  }),
  publicClient.readContract({
    address: ERC8004.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "tokenURI",
    args: [BigInt(agentId)],
  }),
]);

// Persist AGENT_ID / AGENT_ADDRESS to .env.local.
const envPath = path.resolve(".env.local");
let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
for (const [k, v] of Object.entries({ AGENT_ID: agentId, AGENT_ADDRESS: account.address })) {
  const re = new RegExp(`^${k}=.*$`, "m");
  const line = `${k}=${v}`;
  content = re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}`;
}
fs.writeFileSync(envPath, `${content.trimEnd()}\n`);

const balance = await publicClient.getBalance({ address: account.address });
console.log(`\n✅ Registered on-chain agent #${agentId}`);
console.log(`   owner:    ${owner}`);
console.log(`   tokenURI: ${uri}`);
console.log(`   identity: ${agentExplorerUrl(agentId)}`);
console.log(`   tx:       https://testnet.arcscan.app/tx/${hash}`);
console.log(`   gas left: ${formatEther(balance)} USDC (native)`);
console.log(`\nWrote AGENT_ID=${agentId} to .env.local. The buyer agent will now present this identity.`);
