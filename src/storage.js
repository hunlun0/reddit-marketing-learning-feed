import { LIMITS, settings } from "./config.js";
import { retainPosts } from "./feed.js";
import { AppError } from "./errors.js";
export const FEED_KEY = "feed:v2", RUN_KEY = "run:v2", ATTEMPT_KEY = "attempt:v2";
export const emptyFeed = () => ({ version: 2, posts: [], updated_at: null, last_complete_at: null });
function binding(env) { if (!env.CACHE) throw new AppError("storage_missing"); return env.CACHE; }
function validPost(p) {
  return p && typeof p.post_id === "string" && /^[a-z0-9]{1,16}$/.test(p.post_id)
    && ["title", "subreddit", "permalink", "excerpt", "verified_at"].every(k => typeof p[k] === "string")
    && ["categories", "matched_keywords", "matched_queries", "matched_sources"].every(k => Array.isArray(p[k]) && p[k].every(v => typeof v === "string"))
    && ["created_utc", "score", "num_comments"].every(k => Number.isFinite(p[k]));
}
export async function loadFeed(env, now = Date.now()) {
  let raw; try { raw = await binding(env).get(FEED_KEY, "json"); }
  catch (e) { throw e instanceof AppError ? e : new AppError("storage_unavailable"); }
  if (raw === null) return emptyFeed();
  if (!raw || raw.version !== 2 || !Array.isArray(raw.posts) || raw.posts.length > 800 || !raw.posts.every(validPost)) throw new AppError("storage_invalid");
  return { ...raw, posts: retainPosts(raw.posts, settings(env), now) };
}
export async function loadRun(env) {
  try {
    const run = await binding(env).get(RUN_KEY, "json");
    if (run !== null && (typeof run !== "object" || !Number.isFinite(run.started_ms))) throw new AppError("storage_invalid");
    return run;
  } catch (e) { throw e instanceof AppError ? e : new AppError("storage_unavailable"); }
}
export async function saveRun(env, run) {
  try { await binding(env).put(RUN_KEY, JSON.stringify(run), { expirationTtl: 7 * 86400 }); }
  catch (e) { throw e instanceof AppError ? e : new AppError("storage_unavailable"); }
}
export async function saveFeed(env, feed, now = Date.now()) {
  // An unrelated successful query must NEVER renew an unverified old copy for another 48h.
  const posts = retainPosts(feed.posts, settings(env), now).filter(p => Date.parse(p.verified_at) + LIMITS.contentMaxAgeSeconds * 1000 > now + 120000);
  const expiry = posts.length ? Math.min(...posts.map(p => Math.floor(Date.parse(p.verified_at) / 1000) + LIMITS.contentMaxAgeSeconds)) : Math.floor(now / 1000) + LIMITS.contentMaxAgeSeconds;
  const snapshot = { ...feed, posts };
  try { await binding(env).put(FEED_KEY, JSON.stringify(snapshot), { expiration: expiry }); }
  catch (e) { throw e instanceof AppError ? e : new AppError("storage_unavailable"); }
  return snapshot;
}

export async function loadAttempt(env) {
  try {
    const value = await binding(env).get(ATTEMPT_KEY, "json");
    if (value !== null && !Number.isFinite(value?.started_ms)) throw new AppError("storage_invalid");
    return value;
  } catch (e) { throw e instanceof AppError ? e : new AppError("storage_unavailable"); }
}
export async function saveAttempt(env, value) {
  try { await binding(env).put(ATTEMPT_KEY, JSON.stringify(value), { expirationTtl: 86400 }); }
  catch (e) { throw e instanceof AppError ? e : new AppError("storage_unavailable"); }
}
