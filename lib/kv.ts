/**
 * Tiny zero-dependency KV backend for the JSON stores.
 *
 * Locally the stores persist to ./.data/*.json (process.cwd is writable). On a
 * serverless host (Vercel) the filesystem is read-only, so the dashboard would
 * never see any recorded payments/jobs. When KV env vars are present we instead
 * read/write each store as a single JSON blob in Upstash Redis over its REST API
 * — no SDK, just fetch, matching the rest of the project's zero-dep approach.
 *
 * Accepts either naming convention so it works whether you wire Upstash directly
 * or via Vercel's Upstash/KV marketplace integration:
 *   - KV_REST_API_URL        / KV_REST_API_TOKEN          (Vercel KV / integration)
 *   - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   (Upstash console)
 *
 * NOTE: leaf modules that node type-strips directly (lib/store.ts via
 * scripts/traction.mts, lib/jobs.ts via scripts/run-job.mts) CANNOT import this
 * file — a relative `.ts` import breaks the bundler (no allowImportingTsExtensions)
 * and an extensionless one breaks node's type-stripping. Those two inline an
 * identical copy of `kvEnabled`/`kvGetJson`/`kvSetJson` on purpose; keep them in
 * sync with this module. Bundler-only modules (guardrail/*) import from here.
 */

// `||` (not `??`) so an empty-string env var (which some hosts inject) falls
// through to the alternate naming instead of being treated as a real value.
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

/** True when KV credentials are configured (i.e. we should use Redis, not files). */
export function kvEnabled(): boolean {
  return Boolean(KV_URL && KV_TOKEN);
}

async function kvCommand<T>(cmd: unknown[]): Promise<T> {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
    // Never let Next.js cache store reads — the dashboard polls for live data.
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`KV ${String(cmd[0])} failed: HTTP ${res.status}`);
  const json = (await res.json()) as { result: T; error?: string };
  if (json.error) throw new Error(`KV ${String(cmd[0])} error: ${json.error}`);
  return json.result;
}

/** GET a key and JSON.parse it; returns `fallback` when the key is unset or unparsable. */
export async function kvGetJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await kvCommand<string | null>(["GET", key]);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** SET a key to the JSON-serialized value. */
export async function kvSetJson(key: string, value: unknown): Promise<void> {
  await kvCommand(["SET", key, JSON.stringify(value)]);
}
