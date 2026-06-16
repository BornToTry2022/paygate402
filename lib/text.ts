/**
 * Zero-dependency text helpers used by the paid endpoints. These exist so the
 * demo is useful and runnable with no API keys; /api/premium/summarize will use a
 * real LLM instead when OPENAI_API_KEY is set.
 */

const STOPWORDS = new Set(
  ("a an and are as at be but by for from has have he her his i in is it its of on or " +
    "that the their they this to was were will with you your we our us not no so if then " +
    "than them these those which who whom what when where why how all any can do does did " +
    "out up down over under again more most other some such only own same too very s t")
    .split(/\s+/),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Extractive summary: score sentences by summed word frequency, keep top N in order. */
export function summarize(text: string, maxSentences = 3): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
    ?.map((s) => s.trim())
    .filter(Boolean);
  if (!sentences || sentences.length <= maxSentences) return text.trim();

  const freq = new Map<string, number>();
  for (const w of words(text)) freq.set(w, (freq.get(w) ?? 0) + 1);

  const scored = sentences.map((s, i) => {
    const ws = words(s);
    const score = ws.reduce((sum, w) => sum + (freq.get(w) ?? 0), 0) / (ws.length || 1);
    return { i, s, score };
  });

  const top = scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);

  return top.join(" ");
}

export interface Keyword {
  term: string;
  count: number;
}

/** Top-K keywords by frequency (stopwords removed). */
export function keywords(text: string, k = 8): Keyword[] {
  const freq = new Map<string, number>();
  for (const w of words(text)) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, k);
}

/** Optional real LLM summary via the OpenAI REST API (no SDK dependency). */
export async function llmSummarize(text: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return summarize(text);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Summarize the user's text in 2-3 concise sentences." },
          { role: "user", content: text },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) return summarize(text);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || summarize(text);
  } catch {
    return summarize(text);
  }
}
