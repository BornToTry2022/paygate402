"use client";
import { useEffect, useState } from "react";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("guardrail_admin_token") : null;
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

type Policy = {
  merchantId: string; enabled: boolean; dailyCapUsd: number;
  humanApprovalThresholdUsd: number;
  reputationScaling: { baseCapUsd: number; maxCapUsd: number; atScore: number };
  velocity: { maxCount: number; windowMs: number };
};
type Approval = { id: string; endpoint: string; agentId: string | null; amountUsdc: number; reason: string; createdAt: string };
type Payment = { id: string; endpoint: string; amountUsdc: string; agentId: string | null; policyTier?: string; ts: string };

export default function GuardRailPage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [pending, setPending] = useState<Approval[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  async function refresh() {
    const rawPending = await fetch("/api/guardrail/pending", { headers: authHeaders() })
      .then((r) => r.json())
      .catch(() => []);
    setPending(Array.isArray(rawPending) ? rawPending : []);
    const p: Payment[] = await (await fetch("/api/payments")).json().then((d) => d.payments ?? d).catch(() => []);
    setPayments(Array.isArray(p) ? p.slice(0, 15) : []);
  }
  useEffect(() => {
    fetch("/api/guardrail/policies?merchantId=press", { headers: authHeaders() }).then((r) => r.json()).then(setPolicy).catch(() => {});
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  async function savePolicy(next: Policy) {
    setPolicy(next);
    await fetch("/api/guardrail/policies", { method: "PUT", headers: authHeaders({ "content-type": "application/json" }), body: JSON.stringify(next) });
  }
  async function decide(id: string, approve: boolean) {
    await fetch("/api/guardrail/approve", { method: "POST", headers: authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ id, approve }) });
    await refresh();
  }

  return (
    <main style={{ maxWidth: 880, margin: "2rem auto", fontFamily: "ui-sans-serif, system-ui", padding: "0 1rem" }}>
      <h1>GuardRail — agent spend firewall</h1>
      {policy && (
        <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, margin: "16px 0" }}>
          <h2>Policy · {policy.merchantId}</h2>
          <label style={{ display: "block", margin: "8px 0" }}>
            <input type="checkbox" checked={policy.enabled} onChange={(e) => savePolicy({ ...policy, enabled: e.target.checked })} /> enabled
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            daily cap $<input type="number" step="0.01" value={policy.dailyCapUsd} onChange={(e) => savePolicy({ ...policy, dailyCapUsd: Number(e.target.value) })} />
          </label>
          <label style={{ display: "block", margin: "8px 0" }}>
            human-approval threshold $<input type="number" step="0.01" value={policy.humanApprovalThresholdUsd} onChange={(e) => savePolicy({ ...policy, humanApprovalThresholdUsd: Number(e.target.value) })} />
          </label>
        </section>
      )}

      <section style={{ border: "1px solid #f0c", borderRadius: 12, padding: 16, margin: "16px 0" }}>
        <h2>Pending approvals ({pending.length})</h2>
        {pending.length === 0 && <p style={{ color: "#888" }}>none</p>}
        {pending.map((a) => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid #eee" }}>
            <span>{a.endpoint} · ${a.amountUsdc} · agent {a.agentId ?? "—"} · {a.reason}</span>
            <span>
              <button onClick={() => decide(a.id, true)}>approve</button>{" "}
              <button onClick={() => decide(a.id, false)}>deny</button>
            </span>
          </div>
        ))}
      </section>

      <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
        <h2>Recent settled (allowed) payments</h2>
        {payments.map((p) => (
          <div key={p.id} style={{ padding: "6px 0", borderTop: "1px solid #eee", fontSize: 14 }}>
            ✅ {p.endpoint} · ${p.amountUsdc} · agent {p.agentId ?? "—"} {p.policyTier ? `· ${p.policyTier}` : ""}
          </div>
        ))}
      </section>
    </main>
  );
}
