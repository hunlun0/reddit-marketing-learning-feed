import test from "node:test";
import assert from "node:assert/strict";
import { RedditClient } from "../src/reddit.js";
import { apiEnv, child, jsonResponse as j, listing, NOW, sequenceFetch } from "./helpers.js";
const token = () => j({ access_token: "fixture-token", token_type: "bearer", expires_in: 3600 });
const limits = { requestSpacingMs: 0, requestTimeoutMs: 40, refreshDeadlineMs: 5000 };
const client = responses => { const f = sequenceFetch(responses); return { c: new RedditClient(apiEnv(), { fetchImpl: f, limits, sleepImpl: async () => {} }), f }; };

test("credentials missing prevents every network request", () => {
  assert.throws(() => new RedditClient({}, { fetchImpl: () => assert.fail("network must not run") }), { code: "not_configured" });
});
test("application-only OAuth uses Basic POST and only read API GET", async () => {
  const { c, f } = client([token(), j(listing())]); await c.get("/search", { q: "PPC", sort: "new" });
  assert.equal(f.calls[0].url, "https://www.reddit.com/api/v1/access_token"); assert.equal(f.calls[0].init.method, "POST");
  assert.equal(f.calls[0].init.body, "grant_type=client_credentials"); assert.ok(f.calls[0].init.headers.Authorization.startsWith("Basic "));
  assert.equal(f.calls[1].init.headers.Authorization, "Bearer fixture-token"); assert.equal(f.calls[1].init.method, "GET");
  assert.equal(new URL(f.calls[1].url).searchParams.get("raw_json"), "1");
});
test("optional refresh-token grant is explicit and no token is written to storage", async () => {
  const f = sequenceFetch([token(), j(listing())]); const c = new RedditClient({ ...apiEnv(), REDDIT_REFRESH_TOKEN: "fixture-refresh" }, { fetchImpl: f, limits });
  await c.get("/search"); assert.equal(new URLSearchParams(f.calls[0].init.body).get("grant_type"), "refresh_token"); assert.equal(new URLSearchParams(f.calls[0].init.body).get("refresh_token"), "fixture-refresh");
});
test("pagination follows after cursor, not page numbers, and remains bounded", async () => {
  const { c, f } = client([token(), j(listing([child()], "t3_abc1")), j(listing([child("abc2")], "t3_abc2"))]);
  let pages = 0; for await (const page of c.discover({ path: "/search", query: "PPC" }, NOW / 1000 - 30 * 86400)) pages++;
  assert.equal(pages, 2); assert.equal(new URL(f.calls[2].url).searchParams.get("after"), "t3_abc1"); assert.equal(f.calls.length, 3);
});
test("pagination stops on time cutoff and repeated cursors", async () => {
  const { c, f } = client([token(), j(listing([child("abc1", { created_utc: NOW / 1000 - 40 * 86400 })], "t3_abc1"))]);
  for await (const page of c.discover({ path: "/search", query: "PPC" }, NOW / 1000 - 30 * 86400)) assert.equal(page.length, 1);
  assert.equal(f.calls.length, 2);
});
test("page-one results survive a page-two failure", async () => {
  const { c } = client([token(), j(listing([child()], "t3_abc1")), j({ error: "private details" }, 403)]);
  const kept = []; await assert.rejects(async () => { for await (const page of c.discover({ path: "/search", query: "PPC" }, 0)) kept.push(...page); }, { code: "access_denied" }); assert.equal(kept.length, 1);
});
test("401 obtains a fresh token once, not indefinitely", async () => {
  const { c, f } = client([token(), j({}, 401), token(), j(listing()), j({}, 401)]);
  await c.get("/search"); await assert.rejects(c.get("/search"), { code: "auth_failed" }); assert.equal(f.calls.length, 5);
});
test("OAuth 400 is auth failure and never echoes upstream secrets", async () => {
  const { c } = client([j({ error: "SUPER_SECRET_CLIENT_VALUE" }, 400)]);
  await assert.rejects(c.get("/search"), e => e.code === "auth_failed" && !e.message.includes("SUPER_SECRET"));
});
test("403 stops immediately without anonymous or scrape fallback", async () => {
  const { c, f } = client([token(), j({ error: "internal" }, 403)]); await assert.rejects(c.get("/search"), { code: "access_denied" }); assert.equal(f.calls.length, 2);
});
test("429 long Retry-After is respected without burning more calls", async () => {
  const { c, f } = client([token(), j({}, 429, { "Retry-After": "120" })]);
  await assert.rejects(c.get("/search"), { code: "rate_limited" }); assert.equal(f.calls.length, 2);
});
test("429 short Retry-After retries once within a shared retry budget", async () => {
  const { c, f } = client([token(), j({}, 429, { "Retry-After": "1" }), j(listing())]);
  await c.get("/search"); assert.equal(f.calls.length, 3); assert.equal(c.retries, 1);
});
test("zero rate-limit remaining blocks future requests until reset", async () => {
  const { c, f } = client([token(), j(listing(), 200, { "X-Ratelimit-Remaining": "0", "X-Ratelimit-Reset": "600" })]);
  await c.get("/search"); await assert.rejects(c.get("/search"), { code: "rate_limited" }); assert.equal(f.calls.length, 2);
});
test("5xx and transport errors are bounded and recoverable", async () => {
  const { c, f } = client([token(), j({}, 503), j(listing())]); await c.get("/search"); assert.equal(f.calls.length, 3);
  const other = client([token(), new Error("sensitive network hostname"), new Error("again")]); await assert.rejects(other.c.get("/search"), { code: "upstream_error" });
});
test("timeout covers a hanging request and does not expose raw exception", async () => {
  const f = async (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("sensitive detail"))));
  const c = new RedditClient(apiEnv(), { fetchImpl: f, limits: { ...limits, maxRetries: 0 } }); await assert.rejects(c.get("/search"), { code: "timeout" });
});
test("malformed listings and oversized responses fail safely", async () => {
  const { c } = client([token(), j({ data: { children: [] } })]); await assert.rejects(c.get("/search"), { code: "invalid_response" });
  const other = client([token(), j(listing(), 200, { "Content-Length": "99999999" })]); await assert.rejects(other.c.get("/search"), { code: "invalid_response" });
});
test("external request budget includes token fetch and fails closed", async () => {
  const { c, f } = client([token(), j(listing())]); c.limits.maxRequests = 1; await assert.rejects(c.get("/search"), { code: "budget_exhausted" }); assert.equal(f.calls.length, 1);
});
test("arbitrary paths and unsafe IDs cannot trigger upstream writes or SSRF", async () => {
  const { c, f } = client([]); await assert.rejects(c.get("/api/submit"), { code: "bad_request" }); await assert.rejects(c.info(["../users"]), { code: "bad_request" }); assert.equal(f.calls.length, 0);
});

test("malformed verification children are not mistaken for deleted posts", async () => {
  const { c } = client([token(), j(listing([{ kind: "t3", data: { id: "abc1" } }]))]);
  await assert.rejects(c.info(["abc1"]), { code: "invalid_response" });
});
