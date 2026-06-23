import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Tiny JSON-file-backed store for ERC-8183 agent-to-agent jobs.
 *
 * The x402 paywall records *payments* (lib/store.ts). This is its sibling for
 * *jobs*: as `scripts/run-job.mts` walks the hire → escrow → deliver → pay → rate
 * lifecycle it upserts the job here, one phase at a time, so the dashboard can
 * animate the job advancing live (it polls every 2.5s). Same zero-dependency
 * approach — swap for a real DB when you outgrow a JSON file.
 *
 * The script process (`npm run run-job`) and the Next.js server both resolve
 * `process.cwd()` to the project root, so they share `.data/jobs.json`.
 *
 * NOTE: kept dependency-free (no lib-to-lib imports) on purpose, so it resolves
 * identically under both the Next bundler (`@/lib/jobs`) and node's `.ts`
 * type-stripping when `run-job.mts` imports it (`../lib/jobs.ts`). For the same
 * reason the KV backend below is an inlined copy of lib/kv.ts (keep in sync) —
 * it lets the public dashboard show jobs persisted from a local `run-job` when
 * KV env vars are shared between the script and the serverless deployment.
 */

// --- inlined KV backend (see lib/kv.ts; duplicated to keep this a leaf module) ---
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const KV_KEY = "paygate:jobs";
function kvEnabled(): boolean {
  return Boolean(KV_URL && KV_TOKEN);
}
async function kvCommand<T>(cmd: unknown[]): Promise<T> {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`KV ${String(cmd[0])} failed: HTTP ${res.status}`);
  const json = (await res.json()) as { result: T; error?: string };
  if (json.error) throw new Error(`KV ${String(cmd[0])} error: ${json.error}`);
  return json.result;
}

/** Status labels — mirrors `JOB_STATUS` in lib/erc8183.ts (kept local to stay a leaf module). */
const JOB_STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired", "Refunded"];

/** Canonical lifecycle phases, in order. Drives the dashboard stepper. */
export const JOB_PHASES = ["Created", "Funded", "Submitted", "Completed", "Rated"] as const;
export type JobPhase = (typeof JOB_PHASES)[number];

/** One step in a job's timeline — a phase reached, when, and the tx that did it. */
export interface JobStep {
  phase: JobPhase;
  ts: string;
  tx?: string | null;
}

export interface JobRecord {
  /** On-chain job id from AgenticCommerce. */
  jobId: string;
  client: string;
  provider: string;
  evaluator: string;
  /** Provider's ERC-8004 agent identity, if it registered one. */
  providerAgentId: string | null;
  description: string;
  budgetUsdc: string;
  /** USDC actually released to the provider on completion (null until completed). */
  releasedUsdc: string | null;
  /** Numeric on-chain status (0 Open · 1 Funded · 2 Submitted · 3 Completed …). */
  status: number;
  statusLabel: string;
  /** Reputation score the client left for the provider (null until rated). */
  feedbackScore: number | null;
  /** Lifecycle timeline, in order reached. */
  steps: JobStep[];
  createdAt: string;
  updatedAt: string;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "jobs.json");
const MAX_JOBS = 200;

// Serialize read-modify-write so back-to-back phase updates don't clobber each other.
let lock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readAll(): Promise<JobRecord[]> {
  if (kvEnabled()) {
    const raw = await kvCommand<string | null>(["GET", KV_KEY]);
    if (raw == null) return [];
    try { return JSON.parse(raw) as JobRecord[]; } catch { return []; }
  }
  try {
    return JSON.parse(await fs.readFile(FILE, "utf-8")) as JobRecord[];
  } catch {
    return [];
  }
}

async function writeAll(jobs: JobRecord[]): Promise<void> {
  if (kvEnabled()) {
    await kvCommand(["SET", KV_KEY, JSON.stringify(jobs)]);
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  // Write to a temp file then atomically rename over the target, so a concurrent
  // reader (the Next.js server polling /api/jobs) never sees a half-written file
  // while the separate `run-job` process is mid-write. rename() is atomic on the
  // same filesystem; the temp name is unique per process + write.
  const tmp = path.join(DATA_DIR, `jobs.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(jobs, null, 2));
  await fs.rename(tmp, FILE);
}

/** Fields a phase update may set; `step` (if given) is appended to the timeline. */
export type JobPatch = Partial<
  Omit<JobRecord, "jobId" | "steps" | "statusLabel" | "createdAt" | "updatedAt">
> & { step?: JobStep };

/**
 * Create-or-update a job by id. Merges the patch onto the existing record (or a
 * fresh one), appends `patch.step` to the timeline (de-duped by phase, latest
 * wins), and derives `statusLabel` from `status`. Newest job sorts first.
 */
export function upsertJob(jobId: string, patch: JobPatch): Promise<JobRecord> {
  return withLock(async () => {
    const jobs = await readAll();
    const now = new Date().toISOString();
    const idx = jobs.findIndex((j) => j.jobId === jobId);

    const base: JobRecord =
      idx >= 0
        ? jobs[idx]
        : {
            jobId,
            client: "",
            provider: "",
            evaluator: "",
            providerAgentId: null,
            description: "",
            budgetUsdc: "0",
            releasedUsdc: null,
            status: 0,
            statusLabel: JOB_STATUS[0],
            feedbackScore: null,
            steps: [],
            createdAt: now,
            updatedAt: now,
          };

    const { step, ...fields } = patch;
    const next: JobRecord = { ...base, ...fields, updatedAt: now };
    next.statusLabel = JOB_STATUS[next.status] ?? `status ${next.status}`;

    if (step) {
      const steps = base.steps.filter((s) => s.phase !== step.phase);
      steps.push(step);
      // Keep canonical order regardless of arrival order.
      steps.sort((a, b) => JOB_PHASES.indexOf(a.phase) - JOB_PHASES.indexOf(b.phase));
      next.steps = steps;
    }

    if (idx >= 0) jobs[idx] = next;
    else jobs.unshift(next);

    await writeAll(jobs.slice(0, MAX_JOBS));
    return next;
  });
}

export async function listJobs(limit = 50): Promise<JobRecord[]> {
  const jobs = await readAll();
  // Newest activity first.
  return [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}

export interface JobStats {
  count: number;
  completed: number;
  /** USDC currently held in on-chain escrow (Funded/Submitted, i.e. not yet released or refunded). */
  escrowedUsdc: number;
  /** Total USDC released to providers on completion. */
  releasedUsdc: number;
}

function computeStats(jobs: JobRecord[]): JobStats {
  let escrowedUsdc = 0;
  let releasedUsdc = 0;
  let completed = 0;
  for (const j of jobs) {
    // Only Funded(1)/Submitted(2) are still locked; Completed(3) has been released,
    // and terminal states (Rejected/Expired/Refunded) are no longer escrowed.
    if (j.status === 1 || j.status === 2) escrowedUsdc += parseFloat(j.budgetUsdc || "0");
    if (j.releasedUsdc != null) releasedUsdc += parseFloat(j.releasedUsdc);
    if (j.status >= 3) completed++;
  }
  return { count: jobs.length, completed, escrowedUsdc, releasedUsdc };
}

export async function getJobStats(): Promise<JobStats> {
  return computeStats(await readAll());
}

/** One file read → a consistent snapshot of both the job list and the derived stats. */
export async function getJobsAndStats(limit = 50): Promise<{ jobs: JobRecord[]; stats: JobStats }> {
  const all = await readAll();
  const jobs = [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  return { jobs, stats: computeStats(all) };
}
