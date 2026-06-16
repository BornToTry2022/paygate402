"use client";

import { useEffect, useState } from "react";

const EXPLORER = "https://testnet.arcscan.app";

interface PaymentEvent {
  id: string;
  endpoint: string;
  payer: string;
  amountUsdc: string;
  network: string;
  gatewayTx: string | null;
  ts: string;
}
interface Stats {
  totalUsdc: number;
  count: number;
  byEndpoint: Record<string, { count: number; totalUsdc: number }>;
}
interface Balance {
  wallet?: { balance: string };
  gateway?: { total: string; available: string; withdrawing: string; withdrawable: string };
  error?: string;
}

const short = (a: string) => (a && a.startsWith("0x") && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const usd = (n: number) => `$${n.toFixed(6)}`;

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [payments, setPayments] = useState<PaymentEvent[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [p, b] = await Promise.all([
          fetch("/api/payments", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/gateway/balance", { cache: "no-store" })
            .then((r) => r.json())
            .catch(() => null),
        ]);
        if (!alive) return;
        setStats(p.stats);
        setPayments(p.payments ?? []);
        setBalance(b);
      } catch {
        /* keep last good state */
      }
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <main className="wrap">
      <div className="eyebrow">
        <span className="live" />
        Seller dashboard · live
      </div>
      <h1>Nanopayment revenue</h1>
      <p className="lede">
        Incoming x402 payments, settled in USDC on Arc via Circle Gateway batching. Auto-refreshes
        every 2.5s. <a href="/">← endpoints</a>
      </p>

      <div className="grid" style={{ marginTop: 24 }}>
        <div className="card stat">
          <div className="big price">{usd(stats?.totalUsdc ?? 0)}</div>
          <div className="lbl">Total earned (recorded)</div>
        </div>
        <div className="card stat">
          <div className="big">{stats?.count ?? 0}</div>
          <div className="lbl">Payments</div>
        </div>
        <div className="card stat">
          <div className="big">{balance?.gateway?.available ?? "—"}</div>
          <div className="lbl">Gateway available (USDC)</div>
        </div>
        <div className="card stat">
          <div className="big">{balance?.wallet?.balance ?? "—"}</div>
          <div className="lbl">Wallet USDC</div>
        </div>
      </div>

      <h2>By endpoint</h2>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Calls</th>
              <th>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(stats?.byEndpoint ?? {}).length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  No payments yet — run <code>npm run agent -- --limit 0.5</code>.
                </td>
              </tr>
            ) : (
              Object.entries(stats!.byEndpoint).map(([ep, v]) => (
                <tr key={ep}>
                  <td className="mono">{ep}</td>
                  <td className="mono">{v.count}</td>
                  <td className="mono price">{usd(v.totalUsdc)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2>Recent payments</h2>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Endpoint</th>
              <th>Payer</th>
              <th>Amount</th>
              <th>Settlement</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  Waiting for the first nanopayment…
                </td>
              </tr>
            ) : (
              payments.map((p) => (
                <tr key={p.id}>
                  <td className="muted mono">{new Date(p.ts).toLocaleTimeString()}</td>
                  <td className="mono">{p.endpoint.replace("/api/premium", "")}</td>
                  <td className="mono">{short(p.payer)}</td>
                  <td className="mono price">{usd(parseFloat(p.amountUsdc))}</td>
                  <td className="mono">
                    {p.gatewayTx && p.gatewayTx.startsWith("0x") ? (
                      <a href={`${EXPLORER}/tx/${p.gatewayTx}`} target="_blank" rel="noreferrer">
                        {short(p.gatewayTx)}
                      </a>
                    ) : (
                      <span className="muted" title={p.gatewayTx ?? ""}>
                        batched{p.gatewayTx ? ` · ${p.gatewayTx.slice(0, 8)}` : ""}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
