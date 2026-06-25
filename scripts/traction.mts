/**
 * Summarize on-chain PressPay traction and best-effort feed it to the hackathon's
 * arc-canteen CLI. Degrades gracefully when arc-canteen is not installed.
 *
 *   npm run traction          # print the summary
 *   npm run traction -- --push  # also try `arc-canteen update traction`
 */
import { spawnSync } from "node:child_process";
import { listPayments, getStats, getTractionBreakdown } from "../lib/store.ts";

const push = process.argv.includes("--push");

// Treat the project's own fleet/wallets as dogfood so the headline number is
// GENUINE external usage (judges weigh that, not self-dealing volume).
const selfAgentIds = (process.env.SELF_AGENT_IDS ?? process.env.AGENT_ID ?? "668408")
  .split(",").map((s) => s.trim()).filter(Boolean);
const selfAddrs = (process.env.SELF_ADDRESSES ??
  [process.env.BUYER_ADDRESS, process.env.SELLER_ADDRESS].filter(Boolean).join(","))
  .split(",").map((s) => s.trim()).filter(Boolean);

const [stats, payments, traction] = await Promise.all([
  getStats(),
  listPayments(1000),
  getTractionBreakdown({ selfAgentIds, selfAddrs }),
]);
const articlePayments = payments.filter((p) => p.endpoint.startsWith("/api/article/") || p.endpoint === "/api/tip");
const totalToCreator = articlePayments.reduce((s, p) => s + parseFloat(p.amountUsdc || "0"), 0);

const summary = {
  totalPayments: stats.count,
  distinctPayers: traction.distinctPayers,
  distinctExternalPayers: traction.distinctExternalPayers,
  externalPayments: traction.externalPayments,
  externalUsdcToCreator: Number(traction.externalUsdc.toFixed(6)),
  externalBreakdown: { agents: traction.externalAgents, humans: traction.externalHumans },
  selfDogfood: { payments: traction.selfPayments, usdc: Number(traction.selfUsdc.toFixed(6)) },
  articleUnlocksAndTips: articlePayments.length,
  usdcToCreator: Number(totalToCreator.toFixed(6)),
  byEndpoint: stats.byEndpoint,
};

console.log("PressPay traction:");
console.log(JSON.stringify(summary, null, 2));

if (push) {
  const res = spawnSync("arc-canteen", ["update", "traction", "--json", JSON.stringify(summary)], { stdio: "inherit" });
  if (res.error) {
    console.warn("\n[traction] arc-canteen not available — skipped push. Install the ARC CLI to enable it.");
  }
}
