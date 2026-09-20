import test from "node:test";
import assert from "node:assert/strict";
import worker, { makeWorker } from "../src/index.js";
import { authorize, keyConfigured, sessionCookie } from "../src/auth.js";
import { FEED_KEY } from "../src/storage.js";
import { NOW, KEY, stored, MemoryKV } from "./helpers.js";
const base = "https://feed.example.test";
const req = (path, method = "GET", headers = {}) => new Request(base + path, { method, headers });
const env = () => ({ REFRESH_KEY: KEY, CACHE: new MemoryKV(), ASSETS: { fetch: async () => new Response("<!doctype html><title>Feed</title>", { headers: { "Content-Type": "text/html" } }) } });
const bearer = { Authorization: `Bearer ${KEY}` };

test("dashboard and public status remain available without KV, key or API credentials", async () => {
  assert.equal((await worker.fetch(req("/"), { ASSETS: env().ASSETS })).status, 200);
  const res = await worker.fetch(req("/api/status"), {}); assert.equal(res.status, 200); assert.equal((await res.json()).reddit, "not_configured");
});
test("feed is never public and does not read KV before authentication", async () => {
  const e = env(); e.CACHE.get = () => assert.fail("must not read without auth");
  assert.equal((await worker.fetch(req("/api/feed"), e)).status, 401);
});
test("refresh requires a valid Bearer or signed same-origin cookie", async () => {
  const e = env(); let called = 0; const w = makeWorker({ refreshImpl: async () => { called++; return { status: "complete" }; } });
  assert.equal((await w.fetch(req("/api/refresh", "POST"), e)).status, 401);
  assert.equal((await w.fetch(req("/api/refresh", "POST", { Authorization: "Bearer invalid" }), e)).status, 401);
  assert.equal((await w.fetch(req("/api/refresh", "POST", bearer), e)).status, 200); assert.equal(called, 1);
});
test("unsafe refresh methods and query-string keys are rejected", async () => {
  assert.equal((await worker.fetch(req("/api/refresh", "GET", bearer), env())).status, 405);
  assert.equal((await worker.fetch(req("/api/refresh?key=secret", "POST", bearer), env())).status, 400);
});
test("same-origin login produces a signed HttpOnly Secure cookie, not the original key", async () => {
  const res = await worker.fetch(req("/api/session", "POST", { ...bearer, Origin: base }), env());
  assert.equal(res.status, 200); const cookie = res.headers.get("set-cookie");
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) assert.ok(cookie.includes(flag)); assert.ok(!cookie.includes(KEY));
  await authorize(req("/api/feed", "GET", { Cookie: cookie.split(";")[0] }), env());
});
test("signed-cookie mutations require exact Origin and reject cross-site", async () => {
  const cookie = (await sessionCookie(env())).split(";")[0];
  await assert.rejects(authorize(req("/api/refresh", "POST", { Cookie: cookie }), env(), { mutation: true }), { code: "forbidden" });
  await assert.rejects(authorize(req("/api/refresh", "POST", { Cookie: cookie, Origin: "https://attacker.test" }), env(), { mutation: true }), { code: "forbidden" });
  await authorize(req("/api/refresh", "POST", { Cookie: cookie, Origin: base }), env(), { mutation: true });
});
test("cross-origin login with a valid key is still rejected", async () => {
  const res = await worker.fetch(req("/api/session", "POST", { ...bearer, Origin: "https://evil.test" }), env()); assert.equal(res.status, 403);
});
test("tampered, expired cookies and key rotation invalidate sessions", async () => {
  const cookie = (await sessionCookie(env(), NOW)).split(";")[0];
  await assert.rejects(authorize(req("/api/feed", "GET", { Cookie: cookie + "x" }), env(), { now: NOW }), { code: "unauthorized" });
  await assert.rejects(authorize(req("/api/feed", "GET", { Cookie: cookie }), env(), { now: NOW + 8 * 86400000 }), { code: "unauthorized" });
  await assert.rejects(authorize(req("/api/feed", "GET", { Cookie: cookie }), { REFRESH_KEY: KEY + "changed" }, { now: NOW }), { code: "unauthorized" });
});
test("weak or absent REFRESH_KEY fails closed", async () => {
  assert.equal(keyConfigured({ REFRESH_KEY: "short" }), false);
  assert.equal((await worker.fetch(req("/api/feed", "GET", bearer), { REFRESH_KEY: "short" })).status, 503);
});
test("logout clears the cookie and requires same Origin", async () => {
  assert.equal((await worker.fetch(req("/api/logout", "POST"), env())).status, 403);
  const response = await worker.fetch(req("/api/logout", "POST", { Origin: base }), env()); assert.equal(response.status, 200); assert.ok(response.headers.get("set-cookie").includes("Max-Age=0"));
});
test("all responses include CSP/no-store/no-frame and expose no CORS", async () => {
  for (const path of ["/", "/health", "/api/status", "/api/feed", "/unknown"]) {
    const response = await worker.fetch(req(path), env()); assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
    assert.equal(response.headers.get("cache-control"), "no-store, private"); assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
  }
});
test("KV error responses never leak raw provider failures", async () => {
  const e = env(); e.CACHE.failGet = true; const response = await worker.fetch(req("/api/feed", "GET", bearer), e);
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes("SENSITIVE"));
});
test("authenticated missing-credentials refresh returns an explicit non-crashing result", async () => {
  const response = await worker.fetch(req("/api/refresh", "POST", bearer), env()); assert.equal(response.status, 409); assert.equal((await response.json()).code, "not_configured");
});
test("manual route waits for completion instead of claiming a premature 202", async () => {
  let release; const gate = new Promise(r => { release = r; }); let returned = false;
  const w = makeWorker({ refreshImpl: async () => { await gate; return { status: "complete", saved: true }; } });
  const response = w.fetch(req("/api/refresh", "POST", bearer), env()).then(r => { returned = true; return r; });
  await new Promise(r => setTimeout(r, 5)); assert.equal(returned, false); release(); assert.equal((await response).status, 200);
});
test("Cron safely skips absent API credentials and flags total failed runs", async () => {
  await worker.scheduled({}, {}, { waitUntil: () => {} });
  const w = makeWorker({ refreshImpl: async () => ({ status: "failed" }) }); await assert.rejects(w.scheduled({}, {}, { waitUntil: () => {} }), { code: "upstream_error" });
});
test("private feed exposes requested data but never environment secrets", async () => {
  const e = env(); const p = stored("abc1", {}, Date.now()); e.CACHE.seed(FEED_KEY, { version: 2, posts: [p] });
  const response = await worker.fetch(req("/api/feed", "GET", bearer), e), text = await response.text(); assert.equal(response.status, 200);
  assert.ok(text.includes("matched_keywords")); assert.ok(!text.includes(KEY)); assert.ok(!text.includes("REDDIT_CLIENT_SECRET"));
});
