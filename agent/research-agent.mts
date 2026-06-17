/**
 * PayGate402 research-agent — fleet decision loop for PressPay.
 *
 * Reads the free /api/scores and /api/articles feeds, looks up the publisher's
 * AgentScore KYA, runs decideBuy() per article, and (unless --dry-run) pays for
 * BUY decisions via the same GatewayClient x402 flow used by buyer.mts.
 *
 * Usage:
 *   npm run research-agent -- --dry-run --base http://localhost:3000 --min-kya 0
 *   npm run research-agent -- --base http://localhost:3000
 */

import { decideBuy, type FleetPolicy } from "../lib/fleet/decide.ts";

// --- CLI args & policy ---
const args = process.argv.slice(2);

function flag(name: string): boolean {
  return args.includes(name);
}
function opt(name: string, fallback: string): string {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
function optNum(name: string, fallback: number): number {
  const v = parseFloat(opt(name, String(fallback)));
  return isNaN(v) ? fallback : v;
}

const DRY_RUN = flag("--dry-run");
const BASE_URL = opt("--base", process.env.BASE_URL ?? "http://localhost:3000");

const policy: FleetPolicy = {
  minPublisherKya:      optNum("--min-kya",       50),
  perTxCapUsd:         optNum("--per-tx-cap",    0.01),
  dailyBudgetUsd:      optNum("--daily-budget",  0.5),
  approvalThresholdUsd: optNum("--approval-threshold", 0.05),
};

console.log(`[research-agent] base=${BASE_URL} dry-run=${DRY_RUN}`);
console.log(`[research-agent] policy:`, JSON.stringify(policy));

// --- Interfaces for API responses ---
interface ScoreRow {
  agentId: string;
  kya: number;
}
interface Article {
  id: string;
  title: string;
  priceUsd: number;
  publisherAgentId: string;
}

// --- Fetch helpers (graceful degradation on failure) ---
async function fetchScores(): Promise<ScoreRow[]> {
  try {
    const res = await fetch(`${BASE_URL}/api/scores`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { scores: ScoreRow[] };
    return json.scores ?? [];
  } catch (err) {
    console.warn(`[research-agent] /api/scores unavailable: ${(err as Error).message} — treating publisher KYA as 0`);
    return [];
  }
}

async function fetchArticles(): Promise<Article[]> {
  try {
    const res = await fetch(`${BASE_URL}/api/articles`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { articles: Article[] };
    return json.articles ?? [];
  } catch (err) {
    console.warn(`[research-agent] /api/articles unavailable: ${(err as Error).message}`);
    // Static fallback so --dry-run can demonstrate decisions even offline
    return [
      { id: "arc-native-gas",    title: "Why USDC-as-gas changes the math", priceUsd: 0.003, publisherAgentId: "668408" },
      { id: "x402-in-one-page",  title: "x402 in one page",                  priceUsd: 0.002, publisherAgentId: "668408" },
      { id: "erc8004-reputation", title: "ERC-8004: agent identity",          priceUsd: 0.004, publisherAgentId: "668408" },
    ];
  }
}

// --- main ---
async function main() {
  const [scores, articles] = await Promise.all([fetchScores(), fetchArticles()]);

  if (articles.length === 0) {
    console.log("[research-agent] No articles found. Exiting.");
    process.exit(0);
  }

  // Build a KYA lookup: agentId → kya
  const kyaMap = new Map<string, number>(scores.map((s) => [s.agentId, s.kya]));

  // Wallet / Gateway setup — only in live-payment mode
  let gateway: InstanceType<typeof import("@circle-fin/x402-batching/client").GatewayClient> | null = null;
  let ephemeralKey = "" as `0x${string}`;

  // ERC-8004 identity headers (optional, same pattern as buyer.mts)
  const agentId = process.env.AGENT_ID;
  const agentAddress = process.env.AGENT_ADDRESS;
  let proofCache: { headers: Record<string, string>; exp: number } | null = null;

  if (!DRY_RUN) {
    // Wallet imports
    const { GatewayClient } = await import("@circle-fin/x402-batching/client");
    const {
      createWalletClient,
      createPublicClient,
      http,
      erc20Abi,
      parseUnits,
      parseEther,
    } = await import("viem");
    const { arcTestnet } = await import("viem/chains");
    const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
    const { agentControlMessage } = await import("../lib/erc8004.ts");

    const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000" as `0x${string}`;
    const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network";
    const DEPOSIT_AMOUNT = process.env.DEPOSIT_AMOUNT ?? "1";
    const GAS_FUND_AMOUNT = parseEther("0.01");

    const funderKey = process.env.BUYER_PRIVATE_KEY as `0x${string}`;
    if (!funderKey) {
      console.error("[research-agent] Missing BUYER_PRIVATE_KEY. Set it in .env.local.");
      process.exit(1);
    }

    const funderAccount = privateKeyToAccount(funderKey);
    const publicClient = createPublicClient({ chain: arcTestnet, transport: http(ARC_TESTNET_RPC) });
    const funderWallet = createWalletClient({
      account: funderAccount,
      chain: arcTestnet,
      transport: http(ARC_TESTNET_RPC),
    });

    ephemeralKey = generatePrivateKey();
    const ephemeralAccount = privateKeyToAccount(ephemeralKey);
    console.log(`[research-agent] Ephemeral wallet: ${ephemeralAccount.address}`);

    // Fund ephemeral wallet
    console.log("[research-agent] Funding ephemeral wallet...");
    const gasTx = await funderWallet.sendTransaction({ to: ephemeralAccount.address, value: GAS_FUND_AMOUNT });
    await publicClient.waitForTransactionReceipt({ hash: gasTx });
    const usdcAmount = parseUnits(DEPOSIT_AMOUNT, 6);
    const usdcTx = await funderWallet.writeContract({
      address: ARC_TESTNET_USDC,
      abi: erc20Abi,
      functionName: "transfer",
      args: [ephemeralAccount.address, usdcAmount],
    });
    await publicClient.waitForTransactionReceipt({ hash: usdcTx });

    // Deposit into Gateway
    gateway = new GatewayClient({ chain: "arcTestnet", privateKey: ephemeralKey });
    console.log(`[research-agent] Depositing ${DEPOSIT_AMOUNT} USDC into Gateway...`);
    const deposit = await gateway.deposit(DEPOSIT_AMOUNT);
    console.log(`[research-agent] Deposit TX: ${deposit.depositTxHash}`);

    // getAgentHeaders closure (mirrors buyer.mts)
    const _getAgentHeaders = async (): Promise<Record<string, string> | undefined> => {
      if (!agentId) return undefined;
      const nowSec = Math.floor(Date.now() / 1000);
      if (proofCache && proofCache.exp > nowSec) return proofCache.headers;
      const ts = String(nowSec);
      const signature = await funderAccount.signMessage({ message: agentControlMessage(agentId, ts) });
      const headers = {
        "X-Agent-Id": agentId,
        "X-Agent-Address": agentAddress ?? funderAccount.address,
        "X-Agent-Timestamp": ts,
        "X-Agent-Signature": signature,
      };
      proofCache = { headers, exp: nowSec + 120 };
      return headers;
    };

    // checkAndRedeposit (mirrors buyer.mts)
    const REDEPOSIT_THRESHOLD = 500_000n;
    const checkAndRedeposit = async () => {
      const balances = await gateway!.getBalances();
      if (balances.gateway.available < REDEPOSIT_THRESHOLD) {
        console.log(`[research-agent] Gateway balance low (${balances.gateway.formattedAvailable}), redepositing...`);
        const refillTx = await funderWallet.writeContract({
          address: ARC_TESTNET_USDC,
          abi: erc20Abi,
          functionName: "transfer",
          args: [ephemeralAccount.address, usdcAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: refillTx });
        await gateway!.deposit(DEPOSIT_AMOUNT);
      }
    };

    // --- Decision loop (live) ---
    let spentTodayUsd = 0;
    console.log(`\n[research-agent] Evaluating ${articles.length} articles...\n`);

    for (const a of articles) {
      const publisherKya = kyaMap.get(a.publisherAgentId) ?? 0;
      const decision = decideBuy({ articlePriceUsd: a.priceUsd, publisherKya, spentTodayUsd }, policy);
      const label = decision.action.toUpperCase();
      console.log(`${label} — ${decision.reason}  [${a.id} $${a.priceUsd}]`);

      if (decision.action === "buy") {
        try {
          await checkAndRedeposit();
          const headers = await _getAgentHeaders();
          const paid = await gateway!.pay(`${BASE_URL}/api/article/${a.id}`, { method: "GET", headers });
          spentTodayUsd += a.priceUsd;
          console.log(`  => paid ${paid.formattedAmount} USDC (total today: $${spentTodayUsd.toFixed(6)})`);
        } catch (err) {
          console.error(`  => payment failed: ${(err as Error).message}`);
        }
      }
    }

    console.log(`\n[research-agent] Done. Total spent today: $${spentTodayUsd.toFixed(6)} USDC`);
    return;
  }

  // --- Decision loop (dry-run) ---
  let spentTodayUsd = 0;
  console.log(`\n[research-agent] Evaluating ${articles.length} articles (DRY RUN — no payments)...\n`);

  for (const a of articles) {
    const publisherKya = kyaMap.get(a.publisherAgentId) ?? 0;
    const decision = decideBuy({ articlePriceUsd: a.priceUsd, publisherKya, spentTodayUsd }, policy);
    const label = decision.action.toUpperCase();
    console.log(`${label} — ${decision.reason}  [${a.id} $${a.priceUsd}]`);

    if (decision.action === "buy") {
      spentTodayUsd += a.priceUsd;
    }
  }

  console.log(`\n[research-agent] Dry-run complete. Would have spent: $${spentTodayUsd.toFixed(6)} USDC`);
}

main().catch((err) => {
  console.error("[research-agent] Fatal:", err);
  process.exit(1);
});
