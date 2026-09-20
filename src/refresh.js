import { configuration, LIMITS, searchPlan, settings } from "./config.js";
import { AppError, log, safeError } from "./errors.js";
import { mergePost, normalizePost, retainPosts } from "./feed.js";
import { RedditClient } from "./reddit.js";
import { loadFeed, loadAttempt, saveAttempt, saveFeed, saveRun } from "./storage.js";
// Same-isolate protection only. KV is eventually consistent, NOT a distributed mutex.
let active = false;
const stopCodes = new Set(["auth_failed", "access_denied", "rate_limited", "budget_exhausted", "deadline"]);
export async function refresh(env, { trigger = "manual", now = Date.now, clientFactory = e => new RedditClient(e), logger = log } = {}) {
  const config = configuration(env);
  if (config.state !== "configured") {
    logger("refresh_skipped", { trigger, reason: config.state });
    return { status: "not_configured", code: config.state, saved: false };
  }
  if (active) throw new AppError("busy", 409, LIMITS.cooldownSeconds);
  active = true;
  const started = now(), runId = crypto.randomUUID();
  const stats = { queries: searchPlan().length, queries_completed: 0, pages: 0, posts_returned: 0,
    relevant_observations: 0, duplicates: 0, new_posts: 0, removed_posts: 0,
    failures: 0, requests: 0, saved_posts: 0, verification_batches: 0 };
  const errors = []; let feed, client, snapshotSaved = false, runStarted = false;
  const record = () => ({ run_id: runId, started_ms: started, started_at: new Date(started).toISOString(), trigger, ...stats, errors });
  function failure(e, source) {
    const code = safeError(e).code; stats.failures++; errors.push({ source, code });
    logger("refresh_issue", { run_id: runId, source, code }); return code;
  }
  try {
    // Fail closed on unreadable storage: never replace unknown existing contents with an empty feed.
    feed = await loadFeed(env, started);
    const previous = await loadAttempt(env);
    if (previous && started - previous.started_ms < LIMITS.cooldownSeconds * 1000) throw new AppError("busy", 409, Math.max(1, Math.ceil((previous.started_ms + LIMITS.cooldownSeconds * 1000 - started) / 1000)));
    await saveAttempt(env, { run_id: runId, started_ms: started }); runStarted = true;
    logger("refresh_started", { run_id: runId, trigger, queries: stats.queries, old_posts: feed.posts.length });
    client = clientFactory(env);
    const options = settings(env), candidates = new Map();
    const old = new Map(feed.posts.map(p => [p.post_id, p]));
    const historicalCutoff = started / 1000 - options.retentionDays * 86400;
    const completeTime = Date.parse(feed.last_complete_at);
    const cutoff = Number.isFinite(completeTime) ? Math.max(historicalCutoff, completeTime / 1000 - 48 * 3600) : historicalCutoff;
    let halted = false;
    for (const source of searchPlan()) {
      if (halted) break;
      try {
        for await (const children of client.discover(source, cutoff)) {
          stats.pages++; stats.posts_returned += children.length;
          for (const child of children) {
            const p = normalizePost(child, source, now());
            if (!p || p.created_utc < cutoff) continue;
            stats.relevant_observations++;
            if (candidates.has(p.post_id)) stats.duplicates++;
            candidates.set(p.post_id, mergePost(candidates.get(p.post_id), p));
          }
        }
        stats.queries_completed++;
      } catch (error) { halted = stopCodes.has(failure(error, source.id)); }
    }
    // Bound fresh candidates BEFORE /api/info; all retained old IDs are still checked.
    const fresh = [...candidates.values()].sort((a, b) => b.created_utc - a.created_utc || b.quality_score - a.quality_score).slice(0, options.maxPosts);
    const observations = new Map(fresh.map(p => [p.post_id, p]));
    const ids = [...new Set([...old.keys(), ...observations.keys()])];
    const result = new Map(old);
    for (let start = 0; start < ids.length; start += LIMITS.verificationBatchSize) {
      if (halted) break;
      const batch = ids.slice(start, start + LIMITS.verificationBatchSize);
      try {
        const verifiedChildren = await client.info(batch); stats.verification_batches++;
        const authoritative = new Map();
        for (const child of verifiedChildren) {
          const p = normalizePost(child, null, now());
          if (p && batch.includes(p.post_id)) authoritative.set(p.post_id, p);
        }
        // A successful /api/info listing is authoritative: absent/removed/private posts are dropped.
        for (const id of batch) {
          const p = authoritative.get(id);
          if (!p) { if (result.delete(id)) stats.removed_posts++; continue; }
          let context = old.get(id);
          if (observations.has(id)) context = mergePost(context, observations.get(id));
          const merged = mergePost(context, p); merged.verified_at = new Date(now()).toISOString();
          if (!old.has(id)) stats.new_posts++;
          result.set(id, merged);
        }
      } catch (error) { halted = stopCodes.has(failure(error, "verification")); }
    }
    stats.requests = client.requests;
    const complete = stats.failures === 0 && stats.queries_completed === stats.queries;
    // Total upstream failure does NOT become a successful refresh or rewrite/extend cached content.
    const useful = stats.verification_batches > 0 || (complete && ids.length === 0);
    if (useful) {
      const finished = now();
      const snapshot = await saveFeed(env, { version: 2, posts: retainPosts([...result.values()], options, finished),
        updated_at: new Date(finished).toISOString(), last_complete_at: complete ? new Date(finished).toISOString() : feed.last_complete_at }, finished);
      snapshotSaved = true; stats.saved_posts = snapshot.posts.length;
    } else stats.saved_posts = feed.posts.length;
    const status = complete ? "complete" : useful ? "partial" : "failed";
    const report = { ...record(), status, saved: snapshotSaved, completed_at: new Date(now()).toISOString() };
    try { await saveRun(env, report); }
    catch (error) { logger("run_status_write_failed", { run_id: runId, code: safeError(error).code }); report.status_warning = "storage_unavailable"; }
    logger("refresh_completed", { run_id: runId, status, ...stats });
    return report;
  } catch (error) {
    const safe = safeError(error); stats.requests = client?.requests || 0;
    if (runStarted) {
      const report = { ...record(), status: "failed", saved: snapshotSaved, code: safe.code, completed_at: new Date(now()).toISOString() };
      try { await saveRun(env, report); } catch { /* The original snapshot still remains; logs are the fallback. */ }
    }
    logger("refresh_failed", { run_id: runId, code: safe.code, saved: snapshotSaved }); throw safe;
  } finally { active = false; }
}
