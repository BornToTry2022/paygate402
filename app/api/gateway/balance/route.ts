import { NextResponse } from "next/server";
import { erc20Abi, formatUnits } from "viem";
import { ARC, getSellerAddress, publicClient } from "@/lib/arc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GATEWAY_API = "https://gateway-api-testnet.circle.com/v1/balances";

async function walletUsdc(address: `0x${string}`): Promise<string> {
  try {
    const bal = await publicClient.readContract({
      address: ARC.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
    return formatUnits(bal, 6);
  } catch {
    return "0";
  }
}

/** Seller's Gateway balance (settled nanopayment earnings) + on-chain wallet USDC. */
export async function GET() {
  const sellerAddress = getSellerAddress();
  if (!sellerAddress) {
    return NextResponse.json({ error: "SELLER_ADDRESS not configured" }, { status: 500 });
  }

  try {
    const [gwRes, wallet] = await Promise.all([
      fetch(GATEWAY_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          token: "USDC",
          sources: [{ domain: ARC.cctpDomain, depositor: sellerAddress }],
        }),
      }),
      walletUsdc(sellerAddress),
    ]);

    const empty = { total: "0", available: "0", withdrawing: "0", withdrawable: "0" };
    if (!gwRes.ok) {
      return NextResponse.json({ wallet: { balance: wallet }, gateway: empty });
    }

    const data = await gwRes.json();
    const bal = data.balances?.find((b: { domain: number }) => b.domain === ARC.cctpDomain);
    const parse = (v: string) => (v.includes(".") ? v : formatUnits(BigInt(v), 6));
    const available = parse(bal?.balance ?? "0");
    const withdrawing = parse(bal?.withdrawing ?? "0");
    const withdrawable = parse(bal?.withdrawable ?? "0");
    const total = (parseFloat(available) + parseFloat(withdrawing)).toFixed(6);

    return NextResponse.json({
      wallet: { balance: wallet },
      gateway: { total, available, withdrawing, withdrawable },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
