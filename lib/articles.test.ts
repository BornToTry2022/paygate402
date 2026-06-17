import { describe, it, expect } from "vitest";
import { listArticles, getArticleMeta, getArticleBody, PUBLISHER_AGENT_ID } from "./articles";

describe("articles", () => {
  it("lists at least 6 articles as metadata WITHOUT the body", () => {
    const list = listArticles();
    expect(list.length).toBeGreaterThanOrEqual(6);
    for (const a of list) {
      expect(a).toHaveProperty("id");
      expect(a).toHaveProperty("title");
      expect(a).toHaveProperty("blurb");
      expect(typeof a.priceUsd).toBe("number");
      expect(a.priceUsd).toBeGreaterThan(0);
      expect(a.publisherAgentId).toBe(PUBLISHER_AGENT_ID);
      expect(a).not.toHaveProperty("body"); // body is paywalled, never in the list
    }
  });
  it("ids are unique", () => {
    const ids = listArticles().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("getArticleMeta returns the article (no body) for a valid id, null otherwise", () => {
    const id = listArticles()[0].id;
    expect(getArticleMeta(id)?.id).toBe(id);
    expect(getArticleMeta(id)).not.toHaveProperty("body");
    expect(getArticleMeta("nope")).toBeNull();
  });
  it("getArticleBody returns a non-empty body for a valid id, null otherwise", () => {
    const id = listArticles()[0].id;
    expect((getArticleBody(id) ?? "").length).toBeGreaterThan(0);
    expect(getArticleBody("nope")).toBeNull();
  });
});
