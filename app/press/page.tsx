"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Article = { id: string; title: string; blurb: string; priceUsd: number; publisherAgentId: string };
type Payment = { endpoint: string; amountUsdc: string };

export default function PressHome() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    fetch("/api/articles").then((r) => r.json()).then((d) => setArticles(d.articles ?? [])).catch(() => {});
    async function refresh() {
      const d = await fetch("/api/payments").then((r) => r.json()).catch(() => ({ payments: [] }));
      setPayments(Array.isArray(d.payments) ? d.payments : []);
    }
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  const articlePayments = payments.filter((p) => p.endpoint.startsWith("/api/article/") || p.endpoint === "/api/tip");
  const totalEarned = articlePayments.reduce((s, p) => s + parseFloat(p.amountUsdc || "0"), 0);
  const unlocks = (id: string) => payments.filter((p) => p.endpoint === `/api/article/${id}`).length;

  return (
    <main style={{ maxWidth: 760, margin: "2rem auto", fontFamily: "ui-serif, Georgia, serif", padding: "0 1rem" }}>
      <header style={{ borderBottom: "2px solid #111", paddingBottom: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 34 }}>PressPay</h1>
        <p style={{ color: "#555", margin: "4px 0 0" }}>An agent-payable publication on Circle Arc — unlock a single piece for sub-cent USDC.</p>
        <div style={{ marginTop: 10, fontFamily: "ui-sans-serif, system-ui", fontSize: 14 }}>
          <strong>{totalEarned.toFixed(6)} USDC</strong> earned · <strong>{articlePayments.length}</strong> paid unlocks/tips
        </div>
      </header>
      {articles.map((a) => (
        <article key={a.id} style={{ marginBottom: 22 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 22 }}>
            <Link href={`/press/article/${a.id}`} style={{ color: "#111", textDecoration: "none" }}>{a.title}</Link>
          </h2>
          <p style={{ color: "#444", margin: "0 0 6px" }}>{a.blurb}</p>
          <div style={{ fontFamily: "ui-sans-serif, system-ui", fontSize: 13, color: "#777" }}>
            🔓 ${a.priceUsd} · {unlocks(a.id)} unlock{unlocks(a.id) === 1 ? "" : "s"}
          </div>
        </article>
      ))}
    </main>
  );
}
