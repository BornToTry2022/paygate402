/**
 * ERC-8183 agent-to-agent job, end to end on Arc Testnet:
 *   a CLIENT agent hires a PROVIDER agent, funds USDC escrow, the provider submits
 *   a deliverable, an EVALUATOR releases payment, and the client leaves ERC-8004
 *   reputation feedback — closing the identity -> hired -> paid -> reputation loop.
 *
 *   npm run run-job
 *
 * Wallets: client = BUYER (funds escrow + gas). provider + evaluator are generated and
 * gas-funded from the client. The provider registers its own ERC-8004 identity.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  parseEther,
  formatUnits,
  erc20Abi,
  keccak256,
  toBytes,
  parseEventLogs,
  zeroAddress,
} from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { AGENTIC_COMMERCE, agenticCommerceAbi, JOB_STATUS } from "../lib/erc8183.ts";
import { ERC8004, identityRegistryAbi, reputationRegistryAbi, agentExplorerUrl } from "../lib/erc8004.ts";
import { upsertJob } from "../lib/jobs.ts";

const RPC = "https://rpc.testnet.arc.network";
const USDC = "0x3600000000000000000000000000000000000000" as const;
const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const ex = (h: string) => `https://testnet.arcscan.app/tx/${h}`;

const pub = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
const wallet = (account: ReturnType<typeof privateKeyToAccount>) =>
  createWalletClient({ account, chain: arcTestnet, transport: http(RPC) });
const send = async (w: ReturnType<typeof wallet>, label: string, params: Parameters<typeof w.writeContract>[0]) => {
  const hash = await w.writeContract(params);
  await pub.waitForTransactionReceipt({ hash });
  console.log(`   ${label}: ${ex(hash)}`);
  return hash;
};
const usdc = (n: bigint) => formatUnits(n, 6);
const balOf = (a: `0x${string}`) =>
  pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] }) as Promise<bigint>;

// --- wallets ---
const clientKey = process.env.BUYER_PRIVATE_KEY as `0x${string}`;
if (!clientKey) {
  console.error("Missing BUYER_PRIVATE_KEY (the client). Run `npm run generate-wallets` first.");
  process.exit(1);
}
const client = privateKeyToAccount(clientKey);
const providerAcct = privateKeyToAccount(generatePrivateKey());
const evaluatorAcct = privateKeyToAccount(generatePrivateKey());
const clientW = wallet(client);
const providerW = wallet(providerAcct);
const evaluatorW = wallet(evaluatorAcct);

console.log("=== ERC-8183 agent-to-agent job ===");
console.log(`client    (BUYER)    ${client.address}`);
console.log(`provider  (worker)   ${providerAcct.address}`);
console.log(`evaluator            ${evaluatorAcct.address}`);

const BUDGET = parseUnits("0.05", 6); // 0.05 USDC escrow

// --- Phase 0: fund provider + evaluator gas from client ---
console.log("\n[0] funding provider + evaluator gas from client...");
const g1 = await clientW.sendTransaction({ to: providerAcct.address, value: parseEther("0.05") });
await pub.waitForTransactionReceipt({ hash: g1 });
const g2 = await clientW.sendTransaction({ to: evaluatorAcct.address, value: parseEther("0.03") });
await pub.waitForTransactionReceipt({ hash: g2 });
console.log("   gas funded.");

// --- Phase 1: provider registers its ERC-8004 identity ---
console.log("\n[1] provider registers an ERC-8004 identity...");
const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const regHash = await send(providerW, "register", {
  address: ERC8004.identityRegistry,
  abi: identityRegistryAbi,
  functionName: "register",
  args: [`${baseUrl}/.well-known/agent-card.json`],
});
const regReceipt = await pub.getTransactionReceipt({ hash: regHash });
const mint = parseEventLogs({ abi: identityRegistryAbi, eventName: "Transfer", logs: regReceipt.logs }).find(
  (l) => l.args.from === zeroAddress && l.args.to.toLowerCase() === providerAcct.address.toLowerCase(),
);
const providerAgentId = mint!.args.tokenId.toString();
console.log(`   provider is on-chain agent #${providerAgentId} -> ${agentExplorerUrl(providerAgentId)}`);

// --- Phase 2: job lifecycle ---
const feeBP = (await pub.readContract({
  address: AGENTIC_COMMERCE,
  abi: agenticCommerceAbi,
  functionName: "evaluatorFeeBP",
})) as bigint;
console.log(`\n[2] creating job (budget ${usdc(BUDGET)} USDC, evaluator fee ${Number(feeBP) / 100}%)...`);

const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 86_400);
const { result: jobIdSim, request: createReq } = await pub.simulateContract({
  account: client,
  address: AGENTIC_COMMERCE,
  abi: agenticCommerceAbi,
  functionName: "createJob",
  args: [providerAcct.address, evaluatorAcct.address, expiredAt, "Summarize the Arc nanopayments dataset", zeroAddress],
});
const createHash = await clientW.writeContract(createReq);
await pub.waitForTransactionReceipt({ hash: createHash });
const created = parseEventLogs({
  abi: agenticCommerceAbi,
  eventName: "JobCreated",
  logs: (await pub.getTransactionReceipt({ hash: createHash })).logs,
})[0];
const jobId = (created?.args.jobId ?? jobIdSim) as bigint;
console.log(`   job #${jobId} created: ${ex(createHash)}`);

// Persist for the dashboard. We upsert after every phase so the live dashboard
// (it polls /api/jobs every 2.5s) animates the job advancing Created → … → Rated.
await upsertJob(jobId.toString(), {
  client: client.address,
  provider: providerAcct.address,
  evaluator: evaluatorAcct.address,
  providerAgentId,
  description: "Summarize the Arc nanopayments dataset",
  budgetUsdc: usdc(BUDGET),
  status: 0,
  step: { phase: "Created", ts: new Date().toISOString(), tx: createHash },
});

await logStatus("after createJob");

console.log("\n[3] provider sets budget...");
await send(providerW, "setBudget", {
  address: AGENTIC_COMMERCE,
  abi: agenticCommerceAbi,
  functionName: "setBudget",
  args: [jobId, BUDGET, "0x"],
});

console.log("\n[4] client approves + funds USDC escrow...");
await send(clientW, "approve", {
  address: USDC,
  abi: erc20Abi,
  functionName: "approve",
  args: [AGENTIC_COMMERCE, BUDGET],
});
const fundHash = await send(clientW, "fund", {
  address: AGENTIC_COMMERCE,
  abi: agenticCommerceAbi,
  functionName: "fund",
  args: [jobId, "0x"],
});
await upsertJob(jobId.toString(), {
  status: 1,
  step: { phase: "Funded", ts: new Date().toISOString(), tx: fundHash },
});
await logStatus("after fund (escrowed)");

console.log("\n[5] provider submits deliverable hash...");
const deliverable = keccak256(toBytes("PayGate402 nanopayments dataset summary v1"));
const submitHash = await send(providerW, "submit", {
  address: AGENTIC_COMMERCE,
  abi: agenticCommerceAbi,
  functionName: "submit",
  args: [jobId, deliverable, "0x"],
});
await upsertJob(jobId.toString(), {
  status: 2,
  step: { phase: "Submitted", ts: new Date().toISOString(), tx: submitHash },
});
await logStatus("after submit");

console.log("\n[6] evaluator approves -> releases escrow...");
const providerBefore = await balOf(providerAcct.address);
const completeHash = await send(evaluatorW, "complete", {
  address: AGENTIC_COMMERCE,
  abi: agenticCommerceAbi,
  functionName: "complete",
  args: [jobId, keccak256(toBytes("approved: matches spec")), "0x"],
});
const completeLogs = (await pub.getTransactionReceipt({ hash: completeHash })).logs;
const released = parseEventLogs({ abi: agenticCommerceAbi, eventName: "PaymentReleased", logs: completeLogs })[0];
const feePaid = parseEventLogs({ abi: agenticCommerceAbi, eventName: "EvaluatorFeePaid", logs: completeLogs })[0];
const providerAfter = await balOf(providerAcct.address);
await upsertJob(jobId.toString(), {
  status: 3,
  releasedUsdc: usdc(released ? released.args.amount : providerAfter - providerBefore),
  step: { phase: "Completed", ts: new Date().toISOString(), tx: completeHash },
});
await logStatus("after complete");

console.log(`\n   provider received ${usdc(providerAfter - providerBefore)} USDC` +
  (released ? ` (PaymentReleased: ${usdc(released.args.amount)})` : "") +
  (feePaid ? `, evaluator fee ${usdc(feePaid.args.amount)} USDC` : ""));

// --- Phase 3: reputation loop ---
console.log("\n[7] client leaves ERC-8004 feedback for the provider agent...");
const FEEDBACK_SCORE = 95;
const feedbackHash = await send(clientW, "giveFeedback", {
  address: ERC8004.reputationRegistry,
  abi: reputationRegistryAbi,
  functionName: "giveFeedback",
  args: [BigInt(providerAgentId), BigInt(FEEDBACK_SCORE), 0, "job-quality", "", "agentic-commerce", "", ZERO32],
});
await upsertJob(jobId.toString(), {
  feedbackScore: FEEDBACK_SCORE,
  step: { phase: "Rated", ts: new Date().toISOString(), tx: feedbackHash },
});

console.log(`\n✅ Done. Agent #${providerAgentId} was hired, delivered, got paid, and earned reputation.`);
console.log(`   identity: ${agentExplorerUrl(providerAgentId)}`);

async function logStatus(label: string) {
  const j = (await pub.readContract({
    address: AGENTIC_COMMERCE,
    abi: agenticCommerceAbi,
    functionName: "jobs",
    args: [jobId],
  })) as readonly [bigint, string, string, string, string, bigint, bigint, number, string];
  const status = Number(j[7]);
  console.log(`   status: ${status} (${JOB_STATUS[status] ?? "?"}) — ${label}`);
}
