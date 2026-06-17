"use client";
import { useEffect, useState, use } from "react";
import Link from "next/link";

type Article = { id: string; title: string; blurb: string; priceUsd: number; publisherAgentId: string };

export default function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [article, setArticle] = useState<Article | null>(null);
  const [unlocks, setUnlocks] = useState(0);

  useEffect(() => {
    fetch("/api/articles").then((r) => r.json())
      .then((d) => setArticle((d.articles ?? []).find((a: Article) => a.id === id) ?? null)).catch(() => {});
    fetch("/api/payments").then((r) => r.json())
      .then((d) => setUnlocks((Array.isArray(d.payments) ? d.payments : []).filter((p: { endpoint: string }) => p.endpoint === `/api/article/${id}`).length))
      .catch(() => {});
  }, [id]);

  if (!article) return <main style={{ maxWidth: 680, margin: "3rem auto", fontFamily: "ui-serif, Georgia, serif" }}><Link href="/press">← PressPay</Link><p>Loading…</p></main>;

  return (
    <main style={{ maxWidth: 680, margin: "2rem auto", fontFamily: "ui-serif, Georgia, serif", padding: "0 1rem" }}>
      <Link href="/press" style={{ fontFamily: "ui-sans-serif, system-ui", fontSize: 14 }}>← PressPay</Link>
      <h1 style={{ fontSize: 30, marginTop: 12 }}>{article.title}</h1>
      <p style={{ fontSize: 19, color: "#333" }}>{article.blurb}</p>
      <div style={{ border: "1px dashed #bbb", borderRadius: 10, padding: 18, marginTop: 18, fontFamily: "ui-sans-serif, system-ui", background: "#fafafa" }}>
        <div style={{ fontWeight: 600 }}>🔒 The rest of this piece is agent-payable for ${article.priceUsd} in USDC.</div>
        <div style={{ color: "#666", fontSize: 14, marginTop: 6 }}>
          An autonomous agent unlocks it with an x402 payment: <code>GET /api/article/{article.id}</code>. {unlocks} unlock{unlocks === 1 ? "" : "s"} so far.
        </div>
      </div>
    </main>
  );
}
