import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * lib/kv.ts captures the credentials at module load, so each test resets the
 * module registry and re-imports after stubbing env + global fetch. This guards
 * the Upstash REST command shape (["GET"/"SET", ...]) and the env detection that
 * the whole serverless-persistence path depends on.
 */
function clearKvEnv() {
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("KV_REST_API_TOKEN", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
}

describe("kv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("kvEnabled() is false when no credentials are set", async () => {
    vi.resetModules();
    clearKvEnv();
    const { kvEnabled } = await import("./kv");
    expect(kvEnabled()).toBe(false);
  });

  it("kvEnabled() is true with KV_* naming", async () => {
    vi.resetModules();
    clearKvEnv();
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "tok_123");
    const { kvEnabled } = await import("./kv");
    expect(kvEnabled()).toBe(true);
  });

  it("kvEnabled() falls through empty KV_* to UPSTASH_* naming", async () => {
    vi.resetModules();
    clearKvEnv();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://u.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "utok");
    const { kvEnabled } = await import("./kv");
    expect(kvEnabled()).toBe(true);
  });

  it("kvSetJson posts ['SET', key, json] with bearer auth to the REST url", async () => {
    vi.resetModules();
    clearKvEnv();
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "tok_123");
    const calls: { url: unknown; init: { body: string; headers: Record<string, string> } }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init: { body: string; headers: Record<string, string> }) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ result: "OK" }), { status: 200 });
      }),
    );
    const { kvSetJson } = await import("./kv");
    await kvSetJson("paygate:test", { a: 1, b: [2, 3] });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://example.upstash.io");
    expect(calls[0].init.headers.Authorization).toBe("Bearer tok_123");
    expect(JSON.parse(calls[0].init.body)).toEqual([
      "SET",
      "paygate:test",
      JSON.stringify({ a: 1, b: [2, 3] }),
    ]);
  });

  it("kvGetJson sends ['GET', key] and parses the stored JSON from result", async () => {
    vi.resetModules();
    clearKvEnv();
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "tok_123");
    const stored = [{ id: "p1", amountUsdc: "0.002" }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: { body: string }) => {
        expect(JSON.parse(init.body)).toEqual(["GET", "paygate:payments"]);
        return new Response(JSON.stringify({ result: JSON.stringify(stored) }), { status: 200 });
      }),
    );
    const { kvGetJson } = await import("./kv");
    expect(await kvGetJson("paygate:payments", [])).toEqual(stored);
  });

  it("kvGetJson returns the fallback when the key is unset (result null)", async () => {
    vi.resetModules();
    clearKvEnv();
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "tok_123");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ result: null }), { status: 200 })),
    );
    const { kvGetJson } = await import("./kv");
    expect(await kvGetJson("missing", [])).toEqual([]);
  });

  it("throws on a non-2xx response so callers can surface the failure", async () => {
    vi.resetModules();
    clearKvEnv();
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "tok_123");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const { kvGetJson } = await import("./kv");
    await expect(kvGetJson("k", null)).rejects.toThrow(/HTTP 500/);
  });
});
