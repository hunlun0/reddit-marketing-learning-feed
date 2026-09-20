import { normalizePost } from "../src/feed.js";
export const NOW = Date.parse("2026-09-20T01:00:00Z");
export const KEY = "test-only-not-a-real-secret-" + "x".repeat(40);
export const apiEnv = () => ({ REDDIT_CLIENT_ID: "fixture-id", REDDIT_CLIENT_SECRET: "fixture-secret",
  REDDIT_USER_AGENT: "web:reddit-marketing-learning-feed:v1.0.1 (by /u/fixture_owner)", REFRESH_KEY: KEY });
export function child(id = "abc1", overrides = {}, now = NOW) {
  return { kind: "t3", data: { id, title: "Google Ads optimization case study", selftext: "A useful PPC template and workflow for conversion tracking.",
    subreddit: "PPC", subreddit_type: "public", created_utc: now / 1000 - 3600,
    score: 20, num_comments: 7, author: "fictional_fixture_author", over_18: false,
    is_self: true, permalink: `/r/PPC/comments/${id}/`, ...overrides } };
}
export function stored(id = "abc1", overrides = {}, now = NOW) {
  return { ...normalizePost(child(id, {}, now), { id: "google", query: '"Google Ads"' }, now), verified_at: new Date(now - 3600000).toISOString(), ...overrides };
}
export const listing = (children = [], after = null) => ({ kind: "Listing", data: { children, after } });
export function jsonResponse(value, status = 200, headers = {}) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } }); }
export class MemoryKV {
  constructor() { this.values = new Map(); this.puts = []; this.failGet = false; this.failPut = null; }
  async get(key, type) {
    if (this.failGet) throw new Error("SENSITIVE infrastructure error");
    const value = this.values.get(key); return value === undefined ? null : type === "json" ? JSON.parse(value) : value;
  }
  async put(key, value, options = {}) {
    if (this.failPut === key || this.failPut === true) throw new Error("SENSITIVE provider failure");
    this.values.set(key, value); this.puts.push({ key, value: JSON.parse(value), options });
  }
  seed(key, value) { this.values.set(key, JSON.stringify(value)); return this; }
}
export function sequenceFetch(responses) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url: String(url), init }); const next = responses.shift(); if (typeof next === "function") return next(url, init); if (next instanceof Error) throw next; if (!next) throw new Error("Unexpected additional fetch"); return next; };
  fn.calls = calls; return fn;
}
