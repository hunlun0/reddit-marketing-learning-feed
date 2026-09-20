import test from "node:test";
import assert from "node:assert/strict";
import { refresh } from "../src/refresh.js";
import { loadFeed, loadRun, saveFeed, FEED_KEY, RUN_KEY, ATTEMPT_KEY } from "../src/storage.js";
import { AppError } from "../src/errors.js";
import { NOW, apiEnv, child, stored, MemoryKV } from "./helpers.js";
const silent = () => {};
function setup(posts = []) {
  const CACHE = new MemoryKV().seed(FEED_KEY, { version: 2, posts, updated_at: "2026-09-19T01:00:00.000Z", last_complete_at: "2026-09-19T01:00:00.000Z" });
  return { ...apiEnv(), CACHE };
}
function fixtureClient({ searchError, verifyError, children = [child()], verification = children } = {}) {
  return { requests: 0,
    async *discover(source) { this.requests++; if (searchError) throw searchError; if (source.id === "google" || source.id === "templates") yield children; else yield []; },
    async info(ids) { this.requests++; if (verifyError) throw verifyError; return verification.filter(c => ids.includes(c.data.id)); }
  };
}
const run = (env, client, extra = {}) => refresh(env, { now: () => NOW, logger: silent, clientFactory: () => client, ...extra });

test("missing credentials is a non-crashing no-network/no-write state", async () => {
  const env = { CACHE: new MemoryKV() };
  const result = await run(env, null, { clientFactory: () => assert.fail("must not create Reddit client") });
  assert.equal(result.status, "not_configured"); assert.equal(env.CACHE.puts.length, 0);
});
test("successful refresh deduplicates queries, verifies and saves an atomic snapshot", async () => {
  const env = setup(), report = await run(env, fixtureClient()); const feed = await loadFeed(env, NOW);
  assert.equal(report.status, "complete"); assert.equal(report.duplicates, 1); assert.equal(report.new_posts, 1); assert.equal(feed.posts.length, 1);
  assert.ok(feed.posts[0].matched_sources.includes("google")); assert.ok(feed.posts[0].matched_sources.includes("templates"));
  assert.equal(feed.posts[0].verified_at, new Date(NOW).toISOString()); assert.equal(feed.last_complete_at, new Date(NOW).toISOString());
  assert.equal(env.CACHE.puts.filter(x => x.key === FEED_KEY).length, 1);
});
test("stored scores and comments decrease when Reddit's latest values decrease", async () => {
  const env = setup([stored()]); await run(env, fixtureClient({ children: [child("abc1", { score: -2, num_comments: 1 })] }));
  const [p] = (await loadFeed(env, NOW)).posts; assert.equal(p.score, -2); assert.equal(p.num_comments, 1);
});
test("a missing post in successful verification is physically removed from saved snapshot", async () => {
  const env = setup([stored()]); const report = await run(env, fixtureClient({ children: [], verification: [] }));
  assert.equal(report.removed_posts, 1); assert.equal((await loadFeed(env, NOW)).posts.length, 0);
});
test("deleted-author references are removed while still-public posts can remain", async () => {
  const env = setup([stored()]); await run(env, fixtureClient({ verification: [child("abc1", { author: "[deleted]" })] }));
  assert.equal((await loadFeed(env, NOW)).posts[0].author, null);
});
test("all searches failing never updates last_complete_at or rewrites cached feed", async () => {
  const env = setup([stored()]), before = env.CACHE.values.get(FEED_KEY);
  const report = await run(env, fixtureClient({ searchError: new AppError("access_denied", 403) }));
  assert.equal(report.status, "failed"); assert.equal(report.saved, false); assert.equal(env.CACHE.values.get(FEED_KEY), before);
  assert.equal((await loadRun(env)).status, "failed");
});
test("a transient failed query does not discard successful queries", async () => {
  const env = setup(); const c = fixtureClient(); const original = c.discover;
  c.discover = async function* (source) { if (source.id === "meta") { this.requests++; throw new AppError("upstream_error"); } yield* original.call(this, source); };
  const report = await run(env, c); assert.equal(report.status, "partial"); assert.equal(report.failures, 1); assert.equal(report.new_posts, 1);
  assert.equal((await loadFeed(env, NOW)).last_complete_at, "2026-09-19T01:00:00.000Z");
});
test("page-one observations survive transient page-two failure and get verified", async () => {
  const env = setup(); const c = fixtureClient(); c.discover = async function* (source) { this.requests++; if (source.id === "google") { yield [child()]; throw new AppError("upstream_error"); } yield []; };
  const report = await run(env, c); assert.equal(report.status, "partial"); assert.equal((await loadFeed(env, NOW)).posts.length, 1);
});
test("failed verification cannot add new unverified posts or renew old copies", async () => {
  const env = setup([stored("old")]), before = env.CACHE.values.get(FEED_KEY);
  const report = await run(env, fixtureClient({ verifyError: new AppError("upstream_error") }));
  assert.equal(report.status, "failed"); assert.equal(env.CACHE.values.get(FEED_KEY), before);
});
test("partially failed verification preserves old batch without extending its 48h TTL", async () => {
  const oldPosts = Array.from({ length: 101 }, (_, i) => stored("p" + i, { verified_at: new Date(NOW - 24 * 3600000).toISOString() }));
  const env = setup(oldPosts); let batch = 0, failedId;
  const c = fixtureClient({ children: [] }); c.info = async function(ids) { this.requests++; batch++; if (batch === 2) { failedId = ids[0]; throw new AppError("upstream_error"); } return ids.map(id => child(id)); };
  const report = await run(env, c); assert.equal(report.status, "partial");
  const saved = env.CACHE.puts.find(p => p.key === FEED_KEY); assert.equal(saved.options.expiration, Math.floor(NOW / 1000) + 24 * 3600);
  assert.equal(saved.value.posts.find(p => p.post_id === failedId).verified_at, oldPosts.find(p => p.post_id === failedId).verified_at);
});
test("KV read failure stops before any destructive write", async () => {
  const env = setup([stored()]); env.CACHE.failGet = true;
  await assert.rejects(run(env, fixtureClient()), { code: "storage_unavailable" }); assert.equal(env.CACHE.puts.length, 0);
});
test("malformed KV snapshots are not silently replaced", async () => {
  const env = setup(); env.CACHE.seed(FEED_KEY, { version: 2, posts: [{ unexpected: true }] });
  await assert.rejects(run(env, fixtureClient()), { code: "storage_invalid" }); assert.equal(env.CACHE.puts.length, 0);
});
test("snapshot write failure leaves previously saved content unchanged", async () => {
  const env = setup([stored("old")]), before = env.CACHE.values.get(FEED_KEY); env.CACHE.failPut = FEED_KEY;
  await assert.rejects(run(env, fixtureClient()), { code: "storage_unavailable" }); assert.equal(env.CACHE.values.get(FEED_KEY), before);
});
test("metadata-write failure is reported without lying about a successful content save", async () => {
  const env = setup(); env.CACHE.failPut = RUN_KEY; const report = await run(env, fixtureClient());
  assert.equal(report.saved, true); assert.equal(report.status_warning, "storage_unavailable"); assert.equal((await loadFeed(env, NOW)).posts.length, 1);
});
test("cooldown blocks repeated refreshes and no same-key write happens twice per run", async () => {
  const env = setup(); await run(env, fixtureClient());
  const keys = env.CACHE.puts.map(p => p.key); assert.equal(new Set(keys).size, keys.length);
  await assert.rejects(run(env, fixtureClient()), { code: "busy" }); assert.ok(env.CACHE.values.has(ATTEMPT_KEY));
});
test("same-isolate concurrent refresh does not start a second client", async () => {
  const env = setup(); let unblock, reached;
  const ready = new Promise(r => { reached = r; }); const gate = new Promise(r => { unblock = r; });
  const c = fixtureClient(); const discover = c.discover; c.discover = async function* (source) { reached(); await gate; yield* discover.call(this, source); };
  const first = run(env, c); await ready;
  await assert.rejects(run(env, fixtureClient()), { code: "busy" }); unblock(); await first;
});
test("older than 48h data expires on read even if KV returns an unexpired object", async () => {
  const env = setup([stored("old", { verified_at: new Date(NOW - 49 * 3600000).toISOString() })]);
  assert.equal((await loadFeed(env, NOW)).posts.length, 0);
});
test("content near expiry is not saved with an illegal short KV expiration", async () => {
  const env = setup(); const p = stored("old", { verified_at: new Date(NOW - 48 * 3600000 + 30000).toISOString() });
  const result = await saveFeed(env, { version: 2, posts: [p] }, NOW); assert.equal(result.posts.length, 0);
});
test("attempt-storage failure aborts instead of defeating cooldown", async () => {
  const env = setup(); env.CACHE.failPut = ATTEMPT_KEY; await assert.rejects(run(env, fixtureClient()), { code: "storage_unavailable" }); assert.equal(env.CACHE.puts.length, 0);
});
test("structured logs contain only counts/codes, not post text, authors or secrets", async () => {
  const env = setup(), events = []; await run(env, fixtureClient(), { logger: (event, fields) => events.push({ event, ...fields }) });
  const text = JSON.stringify(events); assert.ok(text.includes("refresh_completed"));
  for (const sensitive of [env.REDDIT_CLIENT_SECRET, env.REFRESH_KEY, "fictional_fixture_author", "Google Ads optimization case study"]) assert.ok(!text.includes(sensitive));
});
