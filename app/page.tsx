const ENDPOINTS = [
  {
    method: "POST",
    path: "/api/premium/summarize",
    price: "$0.002",
    desc: "Summarize text (heuristic, or LLM if OPENAI_API_KEY is set).",
    body: `{ "text": "long text here..." }`,
  },
  {
    method: "POST",
    path: "/api/premium/keywords",
    price: "$0.001",
    desc: "Extract top keywords from text.",
    body: `{ "text": "long text here...", "k": 8 }`,
  },
  {
    method: "GET",
    path: "/api/premium/fx-rate",
    price: "$0.0005",
    desc: "Indicative USDC↔EURC rate (wire to Arc StableFX for real quotes).",
    body: null,
  },
];

export default function Home() {
  return (
    <main className="wrap">
      <div className="eyebrow">PayGate402 · Circle Arc Testnet</div>
      <h1>Turn any API into an agent-payable storefront</h1>
      <p className="lede">
        A drop-in <code>withPaywall()</code> wrapper that makes any HTTP route return{" "}
        <strong>HTTP 402</strong> and accept sub-cent <strong>USDC</strong> payments from
        autonomous agents — settled via Circle Gateway batching on Arc, where USDC is the native
        gas token. No accounts, no API keys: payment is identity.
      </p>

      <div className="row" style={{ marginTop: 20 }}>
        <a className="card" href="/dashboard" style={{ padding: "10px 16px" }}>
          → Seller revenue dashboard
        </a>
        <span className="badge">chain 5042002</span>
        <span className="badge">faucet.circle.com</span>
      </div>

      <h2>Paywalled endpoints</h2>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Method</th>
              <th>Endpoint</th>
              <th>Price</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map((e) => (
              <tr key={e.path}>
                <td className="mono">{e.method}</td>
                <td className="mono">{e.path}</td>
                <td className="mono price">{e.price}</td>
                <td className="muted">{e.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Try the 402 (no payment)</h2>
      <p className="muted">
        Any unpaid request returns <code>402 Payment Required</code> with a base64{" "}
        <code>PAYMENT-REQUIRED</code> header describing how to pay:
      </p>
      <pre>{`# Unpaid GET -> 402 + PAYMENT-REQUIRED header
curl -i http://localhost:3000/api/premium/fx-rate

# Unpaid POST -> 402
curl -i -X POST http://localhost:3000/api/premium/summarize \\
  -H 'content-type: application/json' \\
  -d '{"text":"Arc is an L1 where USDC is the gas token..."}'`}</pre>

      <h2>Pay for it (autonomous agent)</h2>
      <p className="muted">
        The buyer agent funds an ephemeral wallet, deposits into Circle Gateway, then signs offchain
        authorizations to pay each endpoint — with a hard spend cap:
      </p>
      <pre>{`npm run generate-wallets          # creates seller + buyer wallets
# fund BUYER_ADDRESS at https://faucet.circle.com (Arc Testnet, USDC)
npm run dev                       # this app (the seller)
npm run agent -- --limit 0.5      # buyer agent pays until 0.5 USDC spent`}</pre>

      <div className="sep" />
      <p className="muted" style={{ fontSize: 13 }}>
        Testnet only. Built on Circle&apos;s <code>@circle-fin/x402-batching</code>; structure adapted
        from <span className="mono">circlefin/arc-nanopayments</span>.
      </p>
    </main>
  );
}
