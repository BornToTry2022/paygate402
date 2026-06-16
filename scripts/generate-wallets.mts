/**
 * Generate seller + buyer wallets and write them to .env.local.
 * Adapted from circlefin/arc-nanopayments (generate-wallets.mts).
 *
 *   npm run generate-wallets
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(".env.local");

const cyan = (s: string) => `\x1b[36m${s}\x1b[39m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const green = (s: string) => `\x1b[32m${s}\x1b[39m`;

function makeWallet(label: string) {
  const privateKey = generatePrivateKey();
  const { address } = privateKeyToAccount(privateKey);
  console.log(`\n${bold(label)}`);
  console.log(`  ${dim("Address:")}     ${cyan(address)}`);
  console.log(`  ${dim("Private key:")} ${cyan(privateKey)}`);
  return { address, privateKey };
}

const seller = makeWallet("Seller (receives USDC)");
const buyer = makeWallet("Buyer (funder wallet — fund this one)");

const values: Record<string, string> = {
  SELLER_ADDRESS: seller.address,
  SELLER_PRIVATE_KEY: seller.privateKey,
  BUYER_ADDRESS: buyer.address,
  BUYER_PRIVATE_KEY: buyer.privateKey,
};

let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
for (const [key, value] of Object.entries(values)) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  content = re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}`;
}
fs.writeFileSync(envPath, `${content.trimEnd()}\n`);

console.log(`\n${green("Written to")} ${envPath}`);
console.log(`
${bold("Next steps:")}
  ${dim("1.")} Fund the buyer wallet with Arc Testnet USDC:
       https://faucet.circle.com/   ->   ${cyan(buyer.address)}
  ${dim("2.")} npm run dev
  ${dim("3.")} npm run agent -- --limit 0.5
`);
