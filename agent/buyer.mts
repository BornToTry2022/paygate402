/**
 * PayGate402 buyer agent.
 *
 * Adapted from circlefin/arc-nanopayments (agent.mts). It:
 *   1. Spawns an ephemeral wallet and funds it from BUYER_PRIVATE_KEY (native USDC
 *      for gas + ERC-20 USDC to deposit).
 *   2. Deposits into Circle Gateway, then signs offchain authorizations to pay each
 *      PayGate402 endpoint (gasless, sub-cent, batched onchain by Gateway).
 *   3. Honors a `--limit <usdc>` spend cap and auto-redeposits when low.
 *
 * Usage:  npm run agent -- --limit 0.5
 */

import { GatewayClient } from "@circle-fin/x402-batching/client";
import {
  createWalletClient,
  createPublicClient,
  http,
  erc20Abi,
  parseUnits,
  parseEther,
} from "viem";
import { arcTestnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import * as readline from "node:readline/promises";

const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000" as const;
const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const DEPOSIT_AMOUNT = process.env.DEPOSIT_AMOUNT ?? "1";
const GAS_FUND_AMOUNT = parseEther("0.01"); // native USDC (18 decimals) for gas
const REDEPOSIT_THRESHOLD = 500_000n; // 0.5 USDC atomic units

const endpoints = [
  {
    url: `${BASE_URL}/api/premium/summarize`,
    method: "POST" as const,
    body: { text: "Arc is a Layer-1 blockchain where USDC is the native gas token, giving stable, sub-cent fees and sub-second deterministic finality — ideal for autonomous agents settling value in real time." },
  },
  {
    url: `${BASE_URL}/api/premium/keywords`,
    method: "POST" as const,
    body: { text: "Circle Gateway batches offchain x402 authorizations into a single onchain settlement, making nanopayments economically viable on Arc." },
  },
  { url: `${BASE_URL}/api/premium/fx-rate`, method: "GET" as const },
];

// --- ERC-8004 on-chain identity (optional) ---
const agentId = process.env.AGENT_ID;
const agentAddress = process.env.AGENT_ADDRESS;
const agentHeaders: Record<string, string> | undefined = agentId
  ? { "X-Agent-Id": agentId, "X-Agent-Address": agentAddress ?? "" }
  : undefined;

// --- CLI args ---
let spendingLimit: number | null = null;
{
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      const v = parseFloat(args[++i]);
      if (isNaN(v) || v <= 0) {
        console.error("--limit must be a positive USDC amount");
        process.exit(1);
      }
      spendingLimit = v;
    }
  }
}
let totalSpent = 0;
let paused = false;
let inFlight = 0;
let index = 0;
let redepositing = false;
let paymentInterval: ReturnType<typeof setInterval>;
let balanceInterval: ReturnType<typeof setInterval>;

if (spendingLimit !== null) console.log(`Spending limit: ${spendingLimit} USDC`);

const funderKey = process.env.BUYER_PRIVATE_KEY as `0x${string}`;
if (!funderKey) {
  console.error("Missing BUYER_PRIVATE_KEY. Run `npm run generate-wallets` first.");
  process.exit(1);
}

const funderAccount = privateKeyToAccount(funderKey);
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(ARC_TESTNET_RPC) });
const funderWallet = createWalletClient({
  account: funderAccount,
  chain: arcTestnet,
  transport: http(ARC_TESTNET_RPC),
});

const ephemeralKey = generatePrivateKey();
const ephemeralAccount = privateKeyToAccount(ephemeralKey);
console.log(`Ephemeral agent wallet: ${ephemeralAccount.address}`);

const usdcAmount = parseUnits(DEPOSIT_AMOUNT, 6);

async function withNonceRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const MAX = 5;
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err as Error).message ?? "";
      const isNonce =
        msg.includes("replacement transaction underpriced") ||
        msg.includes("nonce too low") ||
        msg.includes("already known");
      if (!isNonce || attempt === MAX - 1) throw err;
      const delay = 1000 + Math.random() * 2000;
      console.log(`  ${label}: nonce collision, retrying in ${Math.round(delay)}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

async function fundEphemeral() {
  console.log(`Funding ephemeral wallet from ${funderAccount.address}...`);
  const gasTx = await withNonceRetry(
    () => funderWallet.sendTransaction({ to: ephemeralAccount.address, value: GAS_FUND_AMOUNT }),
    "Gas tx",
  );
  await publicClient.waitForTransactionReceipt({ hash: gasTx });
  console.log(`  Gas funded (${gasTx.slice(0, 10)}...)`);

  const usdcTx = await withNonceRetry(
    () =>
      funderWallet.writeContract({
        address: ARC_TESTNET_USDC,
        abi: erc20Abi,
        functionName: "transfer",
        args: [ephemeralAccount.address, usdcAmount],
      }),
    "USDC tx",
  );
  await publicClient.waitForTransactionReceipt({ hash: usdcTx });
  console.log(`  USDC transferred (${usdcTx.slice(0, 10)}...)`);
}

const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: ephemeralKey });

async function depositToGateway() {
  console.log(`Depositing ${DEPOSIT_AMOUNT} USDC into Gateway Wallet...`);
  const result = await gateway.deposit(DEPOSIT_AMOUNT);
  console.log(`Deposit complete! TX: ${result.depositTxHash}`);
  const updated = await gateway.getBalances();
  console.log(`Gateway available balance: ${updated.gateway.formattedAvailable}`);
}

async function refundAndRedeposit() {
  const tx = await withNonceRetry(
    () =>
      funderWallet.writeContract({
        address: ARC_TESTNET_USDC,
        abi: erc20Abi,
        functionName: "transfer",
        args: [ephemeralAccount.address, usdcAmount],
      }),
    "Redeposit tx",
  );
  await publicClient.waitForTransactionReceipt({ hash: tx });
  await depositToGateway();
}

async function checkAndRedeposit() {
  if (redepositing || paused) return;
  redepositing = true;
  try {
    const balances = await gateway.getBalances();
    if (balances.gateway.available < REDEPOSIT_THRESHOLD) {
      console.log(`\nGateway balance low (${balances.gateway.formattedAvailable}), redepositing...`);
      if (balances.wallet.balance > 0n) await depositToGateway();
      else await refundAndRedeposit();
    }
  } catch (err) {
    console.error("Balance check failed:", (err as Error).message);
  } finally {
    redepositing = false;
  }
}

async function promptForAllowance(): Promise<number> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      "\nSpending limit reached. Enter additional allowance in USDC (or 0 to quit): ",
    );
    const v = parseFloat(answer);
    if (isNaN(v) || v < 0) {
      console.error("Invalid amount. Exiting.");
      process.exit(0);
    }
    if (v === 0) {
      console.log(`Agent stopped. Total spent: ${totalSpent.toFixed(6)} USDC`);
      process.exit(0);
    }
    return v;
  } finally {
    rl.close();
  }
}

async function handleLimitReached() {
  if (spendingLimit === null) return;
  paused = true;
  clearInterval(paymentInterval);
  clearInterval(balanceInterval);
  while (inFlight > 0) await new Promise((r) => setTimeout(r, 100));
  console.log(`\nSpent ${totalSpent.toFixed(6)} / ${spendingLimit.toFixed(6)} USDC (limit reached)`);
  spendingLimit += await promptForAllowance();
  console.log(`New limit: ${spendingLimit.toFixed(6)} USDC`);
  paused = false;
  startPaymentLoop();
}

function startPaymentLoop() {
  balanceInterval = setInterval(checkAndRedeposit, 30_000);
  paymentInterval = setInterval(() => {
    if (paused) return;
    const ep = endpoints[index % endpoints.length];
    index++;
    inFlight++;
    const start = Date.now();
    gateway
      .pay(ep.url, { method: ep.method, body: (ep as { body?: unknown }).body, headers: agentHeaders })
      .then((result) => {
        inFlight--;
        const ms = Date.now() - start;
        totalSpent += parseFloat(result.formattedAmount);
        const limitInfo =
          spendingLimit !== null
            ? ` [spent: ${totalSpent.toFixed(6)}/${spendingLimit.toFixed(6)}]`
            : "";
        console.log(
          `#${index} ${ep.method} ${ep.url.split("/").pop()} -> ${result.formattedAmount} USDC (${ms}ms)${limitInfo}`,
        );
        if (spendingLimit !== null && totalSpent >= spendingLimit) handleLimitReached();
      })
      .catch((err) => {
        inFlight--;
        console.error(`#${index} ${ep.url.split("/").pop()} FAILED: ${(err as Error).message}`);
      });
  }, 1000);
}

// --- main ---
if (agentId) {
  console.log(`Acting as ERC-8004 on-chain agent #${agentId} (${agentAddress})`);
} else {
  console.log("No on-chain identity set — run `npm run register-agent` to give this agent an ERC-8004 identity.");
}
await fundEphemeral();
await depositToGateway();
console.log(`\nPaying ${endpoints.length} endpoints at ~1 tx/sec. Ctrl-C to stop.\n`);
startPaymentLoop();
