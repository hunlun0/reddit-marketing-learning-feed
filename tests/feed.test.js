import test from "node:test";
import assert from "node:assert/strict";
import { configuration, settings, searchPlan, LIMITS } from "../src/config.js";
import { deduplicate, matches, mergePost, normalizePost, relevance, retainPosts } from "../src/feed.js";
import { filterPosts, filterOptions, redditLink } from "../public/view.js";
import { apiEnv, child, stored, NOW } from "./helpers.js";

test("10 bounded sources, grouped queries, curated plus sitewide coverage", () => {
  const plan = searchPlan(); assert.equal(plan.length, 10); assert.equal(plan.filter(p => p.path === "/search").length, 9);
  assert.ok(plan.every(p => !p.query || p.query.length <= 512)); assert.ok(plan.some(p => p.path.includes("PPC+googleads")));
  assert.ok(plan.length * LIMITS.pagesPerSearch + 16 + 3 + LIMITS.maxRetries <= LIMITS.maxRequests);
});
test("invalid numeric settings cannot disable bounds", () => {
  assert.deepEqual(settings({ RETENTION_DAYS: "NaN", MAX_POSTS: "Infinity" }), { retentionDays: 30, maxPosts: 400 });
  assert.deepEqual(settings({ RETENTION_DAYS: "1000", MAX_POSTS: "9999999" }), { retentionDays: 30, maxPosts: 800 });
});
test("missing credentials and placeholder User-Agent are explicit states", () => {
  assert.equal(configuration({}).state, "not_configured"); assert.equal(configuration(apiEnv()).state, "configured");
  assert.equal(configuration({ ...apiEnv(), REDDIT_USER_AGENT: "web:app:v1 (by /u/YOUR_REDDIT_USERNAME)" }).state, "invalid_user_agent");
});
test("normalization extracts requested fields without fetching profiles or comments", () => {
  const p = normalizePost(child(), { id: "test", query: "Google Ads" }, NOW);
  for (const k of ["post_id", "title", "subreddit", "author", "created_utc", "score", "num_comments", "permalink", "url", "excerpt", "matched_keywords", "matched_queries", "category", "categories", "fetched_at"]) assert.ok(k in p, k);
  assert.ok(p.matched_keywords.includes("google ads")); assert.ok(p.categories.includes("Templates & Workflows"));
});
test("dedup unions all provenance but keeps one post and the latest score", () => {
  const a = stored(), b = { ...stored(), score: 2, num_comments: 1, matched_queries: ["another query"], matched_keywords: ["template"], categories: ["Tools"], matched_sources: ["tools"] };
  const [p] = deduplicate([a, b, b]); assert.equal(deduplicate([a, b]).length, 1);
  assert.equal(p.score, 2); assert.equal(p.num_comments, 1); assert.equal(p.matched_queries.length, 2); assert.ok(p.categories.includes("Tools"));
});
test("edited text and deleted author replace old content", () => {
  const old = stored(), updated = normalizePost(child("abc1", { title: "Google Ads updated guide", selftext: "Edited", author: "[deleted]", score: -4 }), null, NOW);
  const merged = mergePost(old, updated); assert.equal(merged.author, null); assert.equal(merged.excerpt, "Edited"); assert.equal(merged.score, -4);
});
test("removed, private, quarantined, NSFW and non-post responses are rejected", () => {
  for (const overrides of [{ selftext: "[deleted]" }, { removed_by_category: "moderator" }, { subreddit_type: "private" }, { subreddit_type: "restricted" }, { over_18: true }, { quarantine: true }, { title: "[removed]" }]) assert.equal(normalizePost(child("abc1", overrides), null, NOW), null);
  assert.equal(normalizePost({ kind: "t1", data: child().data }, null, NOW), null);
});
test("hostile links cannot become dashboard destinations", () => {
  const p = normalizePost(child("abc1", { permalink: "javascript:alert(1)", url: "javascript:alert(2)" }), null, NOW);
  assert.equal(p.url, p.permalink); assert.match(redditLink(p), /^https:\/\/www.reddit.com\/r\/PPC\/comments\/abc1\/$/);
  assert.equal(redditLink({ post_id: 'x"onclick=1', subreddit: "PPC" }), null);
});
test("keyword boundaries avoid AI inside paid or email and support phrase case", () => {
  assert.equal(matches("paid email", "ai"), false); assert.equal(matches("Use AI tools", "ai"), true);
  assert.equal(matches("GOOGLE   ADS guide", "google ads"), true); assert.equal(matches("metadata", "meta"), false);
});
test("generic marketing content is not sufficient", () => {
  assert.equal(relevance("Marketing trends", "I love marketing", "marketing", 100, 50, NOW / 1000, NOW), null);
  assert.equal(normalizePost(child("abc1", { title: "My new AI tool", selftext: "A productivity app", subreddit: "marketing" }), null, NOW), null);
});
test("public subreddits outside the preferred list still qualify", () => {
  assert.ok(normalizePost(child("abc1", { subreddit: "analytics", title: "Google Ads conversion tracking guide" }), null, NOW));
});
test("quality score is explainable and bounded", () => {
  const p = stored(); assert.ok(p.quality_score > 0 && p.quality_score <= 100);
  assert.equal(p.quality_score, Object.values(p.quality_components).reduce((a, b) => a + b, 0));
});
test("30-day creation window and 48-hour verification expiry are independent", () => {
  const p = stored(), old = stored("old", { created_utc: NOW / 1000 - 31 * 86400 }), stale = stored("stale", { verified_at: new Date(NOW - 48 * 3600000).toISOString() });
  assert.deepEqual(retainPosts([old, p, stale], settings(), NOW).map(p => p.post_id), ["abc1"]);
});
test("future and malformed dates are rejected", () => {
  assert.equal(normalizePost(child("abc1", { created_utc: NOW / 1000 + 99999 }), null, NOW), null);
  assert.equal(retainPosts([stored("abc1", { verified_at: "not-a-date" })], settings(), NOW).length, 0);
});
test("sorting newest, score, comments and quality is deterministic and non-mutating", () => {
  const posts = [stored("one", { score: 1, num_comments: 10, quality_score: 99 }), stored("two", { score: 30, num_comments: 1, created_utc: NOW / 1000 - 2, quality_score: 1 })];
  assert.equal(filterPosts(posts, { sort: "newest" }, NOW)[0].post_id, "two");
  assert.equal(filterPosts(posts, { sort: "score" }, NOW)[0].post_id, "two");
  assert.equal(filterPosts(posts, { sort: "comments" }, NOW)[0].post_id, "one");
  assert.equal(filterPosts(posts, { sort: "quality" }, NOW)[0].post_id, "one"); assert.equal(posts[0].post_id, "one");
});
test("all requested filter dimensions and search are applied together", () => {
  const p = stored(); assert.equal(filterPosts([p], { days: 1, category: "Google Ads", keyword: "ppc", subreddit: "PPC", search: "conversion tracking" }, NOW).length, 1);
  assert.equal(filterPosts([p], { subreddit: "marketing" }, NOW).length, 0);
  assert.equal(filterPosts([stored("old", { created_utc: NOW / 1000 - 4 * 86400 })], { days: 3 }, NOW).length, 0);
  assert.ok(filterOptions([p, p]).category.includes("Google Ads"));
});

test("specific GA4 topics qualify outside ad subreddits without an extra Ads keyword", () => {
  const p = normalizePost(child("abc1", { subreddit: "analytics", title: "GA4 event debugging guide", selftext: "How to fix an event measurement issue." }), null, NOW);
  assert.ok(p); assert.ok(p.categories.includes("Tracking & Analytics"));
});
test("ambiguous attribution and GTM terms alone do not admit unrelated posts", () => {
  assert.equal(normalizePost(child("abc1", { subreddit: "literature", title: "Attribution of this poem", selftext: "An attribution guide" }), null, NOW), null);
  assert.equal(normalizePost(child("abc1", { subreddit: "startups", title: "GTM strategy", selftext: "Market positioning" }), null, NOW), null);
});

test("Chinese optimization phrases match naturally inside a Chinese sentence", () => {
  assert.equal(matches("分享我的广告优化经验", "广告优化"), true);
  const p = normalizePost(child("abc1", { subreddit: "ChineseMarketing", title: "分享我的广告优化经验", selftext: "如何改进投放优化工作流" }), null, NOW);
  assert.ok(p); assert.ok(p.categories.includes("Campaign Optimization"));
});
