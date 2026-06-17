/**
 * Summarize on-chain PressPay traction and best-effort feed it to the hackathon's
 * arc-canteen CLI. Degrades gracefully when arc-canteen is not installed.
 *
 *   npm run traction          # print the summary
 *   npm run traction -- --push  # also try `arc-canteen update traction`
 */
import { spawnSync } from "node:child_process";
import { listPayments, getStats } from "../lib/store.ts";

const push = process.argv.includes("--push");

const [stats, payments] = await Promise.all([getStats(), listPayments(1000)]);
const articlePayments = payments.filter((p) => p.endpoint.startsWith("/api/article/") || p.endpoint === "/api/tip");
const uniqueAgents = new Set(payments.map((p) => p.agentId).filter(Boolean)).size;
const totalToCreator = articlePayments.reduce((s, p) => s + parseFloat(p.amountUsdc || "0"), 0);

const summary = {
  totalPayments: stats.count,
  articleUnlocksAndTips: articlePayments.length,
  usdcToCreator: Number(totalToCreator.toFixed(6)),
  uniqueAgents,
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
