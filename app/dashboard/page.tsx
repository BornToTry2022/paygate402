"use client";

import { Fragment, useEffect, useState } from "react";

const EXPLORER = "https://testnet.arcscan.app";
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const agentUrl = (id: string) => `${EXPLORER}/token/${IDENTITY_REGISTRY}/instance/${id}`;
const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;

/** ERC-8183 job lifecycle, in order — drives the stepper. Mirrors lib/jobs.ts. */
const JOB_PHASES = ["Created", "Funded", "Submitted", "Completed", "Rated"] as const;

interface PaymentEvent {
  id: string;
  endpoint: string;
  payer: string;
  amountUsdc: string;
  network: string;
  gatewayTx: string | null;
  agentId: string | null;
  agentAddress: string | null;
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
interface Reputation {
  agentId: string;
  count: number;
  score: number;
}
interface JobStep {
  phase: (typeof JOB_PHASES)[number];
  ts: string;
  tx?: string | null;
}
interface Job {
  jobId: string;
  client: string;
  provider: string;
  evaluator: string;
  providerAgentId: string | null;
  description: string;
  budgetUsdc: string;
  releasedUsdc: string | null;
  status: number;
  statusLabel: string;
  feedbackScore: number | null;
  steps: JobStep[];
  createdAt: string;
  updatedAt: string;
}
interface JobStats {
  count: number;
  completed: number;
  escrowedUsdc: number;
  releasedUsdc: number;
}

const short = (a: string) => (a && a.startsWith("0x") && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const usd = (n: number) => `$${n.toFixed(6)}`;

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [payments, setPayments] = useState<PaymentEvent[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [reputation, setReputation] = useState<Reputation | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobStats, setJobStats] = useState<JobStats | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [p, b, j] = await Promise.all([
          fetch("/api/payments", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/gateway/balance", { cache: "no-store" })
            .then((r) => r.json())
            .catch(() => null),
          fetch("/api/jobs", { cache: "no-store" })
            .then((r) => r.json())
            .catch(() => null),
        ]);
        if (!alive) return;
        setStats(p.stats);
        setPayments(p.payments ?? []);
        setReputation(p.reputation ?? null);
        setBalance(b);
        setJobs(j?.jobs ?? []);
        setJobStats(j?.stats ?? null);
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

  const identity = payments.find((p) => p.agentId) ?? null;

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

      {identity?.agentId && (
        <div
          className="card"
          style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center", borderColor: "#27623a" }}
        >
          <span className="badge price" style={{ borderColor: "#27623a" }}>
            ERC-8004
          </span>
          <span>
            Paid by on-chain agent{" "}
            <a href={agentUrl(identity.agentId)} target="_blank" rel="noreferrer">
              #{identity.agentId}
            </a>
            {reputation && reputation.count > 0 && (
              <>
                {" "}
                <span className="badge price" style={{ borderColor: "#27623a" }}>
                  reputation {reputation.score}/100
                </span>{" "}
                <span className="muted">
                  ({reputation.count} review{reputation.count === 1 ? "" : "s"})
                </span>
              </>
            )}{" "}
            <span className="muted">— a verifiable identity, not just an address ({short(identity.agentAddress ?? "")})</span>
          </span>
        </div>
      )}

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
              <th>Agent</th>
              <th>Payer</th>
              <th>Amount</th>
              <th>Settlement</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  Waiting for the first nanopayment…
                </td>
              </tr>
            ) : (
              payments.map((p) => (
                <tr key={p.id}>
                  <td className="muted mono">{new Date(p.ts).toLocaleTimeString()}</td>
                  <td className="mono">{p.endpoint.replace("/api/premium", "")}</td>
                  <td className="mono">
                    {p.agentId ? (
                      <a href={agentUrl(p.agentId)} target="_blank" rel="noreferrer" className="price">
                        #{p.agentId}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
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

      <h2>
        Agent-to-agent jobs{" "}
        <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· ERC-8183 escrow</span>
      </h2>
      <p className="muted" style={{ marginTop: -4, maxWidth: 660, fontSize: 14 }}>
        One agent hires another: USDC sits in on-chain escrow until an evaluator approves the
        deliverable, then it&apos;s released — and the provider earns ERC-8004 reputation. Run{" "}
        <code>npm run run-job</code> and watch a job advance below.
      </p>

      <div className="grid" style={{ marginTop: 14 }}>
        <div className="card stat">
          <div className="big">{jobStats?.count ?? 0}</div>
          <div className="lbl">Jobs</div>
        </div>
        <div className="card stat">
          <div className="big">{jobStats?.completed ?? 0}</div>
          <div className="lbl">Completed</div>
        </div>
        <div className="card stat">
          <div className="big price">{usd(jobStats?.escrowedUsdc ?? 0)}</div>
          <div className="lbl">USDC escrowed</div>
        </div>
        <div className="card stat">
          <div className="big price">{usd(jobStats?.releasedUsdc ?? 0)}</div>
          <div className="lbl">USDC released to providers</div>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="card muted" style={{ marginTop: 14 }}>
          No jobs yet — run <code>npm run run-job</code> to hire an agent on testnet.
        </div>
      ) : (
        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          {jobs.map((job) => (
            <JobCard key={job.jobId} job={job} />
          ))}
        </div>
      )}
    </main>
  );
}

function JobCard({ job }: { job: Job }) {
  const done = new Set(job.steps.map((s) => s.phase));
  const lastDoneIdx = JOB_PHASES.reduce((acc, ph, i) => (done.has(ph) ? i : acc), -1);
  return (
    <div className="card">
      <div className="jobhead">
        <span className="badge price">job #{job.jobId}</span>
        <span className={`badge ${job.status >= 4 ? "fail" : job.status >= 3 ? "price" : ""}`}>
          {job.statusLabel}
        </span>
        {job.providerAgentId && (
          <span className="muted">
            provider{" "}
            <a className="price" href={agentUrl(job.providerAgentId)} target="_blank" rel="noreferrer">
              agent #{job.providerAgentId}
            </a>
          </span>
        )}
        <span className="grow" />
        <span className="muted mono">
          budget <span className="price">{usd(parseFloat(job.budgetUsdc))}</span>
        </span>
        {job.releasedUsdc != null && (
          <span className="muted mono">
            · released <span className="price">{usd(parseFloat(job.releasedUsdc))}</span>
          </span>
        )}
        {job.feedbackScore != null && (
          <span className="badge price" title="ERC-8004 reputation the client left the provider">
            ★ {job.feedbackScore}/100
          </span>
        )}
      </div>
      {job.description && (
        <div className="muted" style={{ fontSize: 13, margin: "2px 0 14px" }}>
          “{job.description}”
        </div>
      )}
      <Stepper job={job} lastDoneIdx={lastDoneIdx} />
    </div>
  );
}

function Stepper({ job, lastDoneIdx }: { job: Job; lastDoneIdx: number }) {
  const byPhase = new Map(job.steps.map((s) => [s.phase, s]));
  const ratedDone = byPhase.has("Rated");
  return (
    <div className="stepper">
      {JOB_PHASES.map((ph, i) => {
        const step = byPhase.get(ph);
        const isDone = !!step;
        // Terminal failure (Rejected/Expired/Refunded = status ≥ 4) marks the frontier red.
        const isFailed = job.status >= 4 && i === lastDoneIdx;
        // The frontier node pulses only while the job is still moving on-chain
        // (Open/Funded/Submitted) — not once Completed, fully rated, or terminally failed.
        const isActive = !ratedDone && !isFailed && job.status < 3 && i === lastDoneIdx;
        const cls = isDone ? (isFailed ? "done failed" : isActive ? "done active" : "done") : "todo";
        const label = isFailed ? "✕" : isDone ? "✓" : i + 1;
        return (
          <Fragment key={ph}>
            {i > 0 && <div className={`jbar ${isDone ? "done" : ""}`} />}
            <div className={`jnode ${cls}`}>
              {step?.tx ? (
                <a
                  className="jdot"
                  href={txUrl(step.tx)}
                  target="_blank"
                  rel="noreferrer"
                  title={`${ph} · ${step.tx}`}
                >
                  {label}
                </a>
              ) : (
                <span className="jdot">{label}</span>
              )}
              <span className="jlbl">{ph}</span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
