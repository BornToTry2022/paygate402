"use client";
import { useEffect, useState } from "react";

type Breakdown = { reputation: number; jobCompletion: number; paymentReliability: number };
type ScoreRow = {
  agentId: string; kya: number; breakdown: Breakdown; reputationScore: number;
  paymentCount: number; jobCount: number; completedJobs: number; rank: number;
};

const EXPLORER = (agentId: string) =>
  `https://testnet.arcscan.app/token/0x8004A818BFB912233c491871b3d84c89A494BD9e/instance/${agentId}`;

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: "2px 0" }}>
      <span style={{ width: 86, color: "#666" }}>{label}</span>
      <span style={{ flex: 1, height: 8, background: "#eee", borderRadius: 4, overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${Math.round(value * 100)}%`, background: "#5b8def" }} />
      </span>
      <span style={{ width: 36, textAlign: "right", color: "#888" }}>{Math.round(value * 100)}</span>
    </div>
  );
}

export default function ExplorerPage() {
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function refresh() {
      const data = await fetch("/api/scores").then((r) => r.json()).catch(() => ({ scores: [] }));
      setRows(Array.isArray(data.scores) ? data.scores : []);
      setLoaded(true);
    }
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <main style={{ maxWidth: 820, margin: "2rem auto", fontFamily: "ui-sans-serif, system-ui", padding: "0 1rem" }}>
      <h1>AgentScore — KYA trust explorer</h1>
      <p style={{ color: "#666" }}>
        A 0–100 Know-Your-Agent score over ERC-8004 reputation, ERC-8183 job completion, and payment reliability.
        Browsing is free; programmatic per-agent lookups are paywalled at <code>/api/score</code>.
      </p>
      {loaded && rows.length === 0 && <p style={{ color: "#888" }}>No scored agents yet — drive some payments/jobs to populate.</p>}
      {rows.map((r) => (
        <section key={r.agentId} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, margin: "12px 0", display: "flex", gap: 16 }}>
          <div style={{ textAlign: "center", minWidth: 70 }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: r.kya >= 67 ? "#1a8a4a" : r.kya >= 34 ? "#b8860b" : "#b33" }}>{r.kya}</div>
            <div style={{ fontSize: 11, color: "#999" }}>KYA · #{r.rank}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>
              <a href={EXPLORER(r.agentId)} target="_blank" rel="noreferrer">agent #{r.agentId}</a>
              <span style={{ color: "#999", fontWeight: 400, fontSize: 12 }}>
                {" "}· {r.completedJobs}/{r.jobCount} jobs · {r.paymentCount} payments · rep {r.reputationScore}
              </span>
            </div>
            <Bar label="reputation" value={r.breakdown.reputation} />
            <Bar label="jobs" value={r.breakdown.jobCompletion} />
            <Bar label="payments" value={r.breakdown.paymentReliability} />
          </div>
        </section>
      ))}
    </main>
  );
}
