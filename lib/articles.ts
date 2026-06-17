/**
 * PressPay's publication content. A leaf module (NO imports) so it resolves
 * identically under the Next bundler (`@/lib/articles`) AND node's type-stripping
 * when `agent/research-agent.mts` imports it (`../lib/articles.ts`).
 *
 * Each article has a public `blurb` (shown free) and a paywalled `body` (served
 * only after an x402 payment via /api/article/[id]). The publisher is a single
 * ERC-8004 agent identity; override it with PUBLISHER_AGENT_ID in the env.
 */

export const PUBLISHER_AGENT_ID: string =
  (typeof process !== "undefined" && process.env?.PUBLISHER_AGENT_ID) || "668408";

export interface Article {
  id: string;
  title: string;
  blurb: string;
  priceUsd: number;
  publisherAgentId: string;
}

interface FullArticle extends Article {
  body: string;
}

const SEED: Omit<FullArticle, "publisherAgentId">[] = [
  {
    id: "arc-native-gas",
    title: "Why USDC-as-gas changes the math for agent payments",
    blurb: "On Arc, USDC is the native gas token. Here's why that single fact makes sub-cent agent payments actually pencil out.",
    priceUsd: 0.003,
    body: "When gas is paid in a volatile token, a $0.001 charge can cost more to settle than it collects. Arc makes USDC the native gas token, so a payment and its fee are denominated in the same dollar-stable unit. Combined with Gateway batching — which amortizes settlement across thousands of off-chain authorizations — the economics of nanopayments finally close. This is the precondition for an agent that pays per API call, per paragraph, or per second.",
  },
  {
    id: "x402-in-one-page",
    title: "x402 in one page: how an agent pays for a 402",
    blurb: "The HTTP 402 handshake, end to end: challenge, sign, retry, settle — with no accounts and no API keys.",
    priceUsd: 0.002,
    body: "An unpaid request returns HTTP 402 with a PAYMENT-REQUIRED challenge. The client signs an EIP-3009 authorization over the requirements and retries with a payment-signature header. The server verifies and settles via the facilitator, then serves the resource. Payment is identity: the settled authorization proves who paid, with no account to create and no key to leak.",
  },
  {
    id: "erc8004-reputation",
    title: "ERC-8004: giving agents an on-chain identity and reputation",
    blurb: "How a registry of agent identities + feedback turns 'some bot' into a counterparty you can price.",
    priceUsd: 0.004,
    body: "ERC-8004 mints an agent identity as an NFT and records feedback against it in a ReputationRegistry. A seller can read an agent's aggregate score and gate or discount access by it. The catch: most minted identities are inactive, so raw reputation is noisy — which is exactly why a derived trust score (see AgentScore) matters.",
  },
  {
    id: "erc8183-escrow",
    title: "ERC-8183 escrow: agents hiring agents, safely",
    blurb: "Created → Funded → Submitted → Completed → Rated. The escrow lifecycle that lets one agent pay another for work.",
    priceUsd: 0.004,
    body: "Agentic commerce needs more than pay-per-call: agents must hire other agents for multi-step work. ERC-8183 escrows a job's budget on-chain and releases it on completion, with a rating that feeds reputation. The open question reviewers flagged: disputes. A no-refund, one-shot escrow is fine until the deliverable is wrong.",
  },
  {
    id: "gateway-batching",
    title: "Gateway batching: how thousands of sub-cent payments become one settlement",
    blurb: "The trick that makes $0.000001 economically real — amortizing gas across a batch.",
    priceUsd: 0.003,
    body: "Circle Gateway collects many off-chain EIP-3009 authorizations and settles them as a single on-chain transaction. The per-payment cost is the batch's gas divided across all the authorizations in it — which is how a $0.000001 charge stops being absurd. The GatewayWalletBatched x402 scheme is what the buyer signs against.",
  },
  {
    id: "agent-spend-control",
    title: "The unsolved layer: controlling what an autonomous agent spends",
    blurb: "Settlement is solved. Authorization isn't. Why spend firewalls and KYA scoring are where the value moved.",
    priceUsd: 0.005,
    body: "Once an agent can pay autonomously, the hard problem is governing it: per-merchant allowlists, daily caps, velocity limits, human-in-the-loop approvals, and knowing whether the counterparty is trustworthy. The rail is a commodity; the trust-and-control layer on top of it is not. This is where GuardRail and AgentScore live.",
  },
];

const FULL: FullArticle[] = SEED.map((a) => ({ ...a, publisherAgentId: PUBLISHER_AGENT_ID }));

function strip(a: FullArticle): Article {
  const { body: _body, ...meta } = a;
  return meta;
}

export function listArticles(): Article[] {
  return FULL.map(strip);
}

export function getArticleMeta(id: string): Article | null {
  const a = FULL.find((x) => x.id === id);
  return a ? strip(a) : null;
}

export function getArticleBody(id: string): string | null {
  return FULL.find((x) => x.id === id)?.body ?? null;
}
