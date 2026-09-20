import { CONTEXT_TERMS, LEARNING_SIGNALS, LIMITS, PRIORITY_SUBREDDITS, SEARCH_GROUPS } from "./config.js";

const patterns = new Map();
function pattern(term) {
  if (!patterns.has(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    // Unicode word boundaries: "AI" must not match "paid" or "email".
    patterns.set(term, new RegExp(/\p{Script=Han}/u.test(term) ? escaped : `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu"));
  }
  return patterns.get(term);
}
export const matches = (text, term) => pattern(term).test(String(text || ""));
const hits = (text, terms) => terms.filter(term => matches(text, term));
const clean = (v, max) => typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
const number = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const union = (a = [], b = []) => [...new Set([...a, ...b])];
export function safeExternalUrl(value, fallback) {
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.href.slice(0, 2048) : fallback; }
  catch { return fallback; }
}
export function relevance(title, body, subreddit, score, comments, created, now) {
  const text = title + " " + body;
  const priority = PRIORITY_SUBREDDITS.some(s => s.toLowerCase() === subreddit.toLowerCase());
  // r/marketing by itself is NOT enough to qualify a generic post.
  const specialist = priority && subreddit.toLowerCase() !== "marketing";
  const context = CONTEXT_TERMS.some(t => matches(text, t)) || specialist;
  const matched = SEARCH_GROUPS.filter(g => !g.needsContext || context)
    .map(group => ({ group, keywords: [...hits(text, group.keywords), ...(context ? hits(text, group.contextKeywords || []) : [])] })).filter(g => g.keywords.length);
  if (!matched.length) return null;
  const groups = matched.map(g => g.group);
  const keywords = union([], matched.flatMap(g => g.keywords));
  const titleHits = hits(title, keywords).length;
  const learning = LEARNING_SIGNALS.filter(s => hits(text, s.terms).length).map(s => s.label);
  // Strong platform match qualifies; general tooling/workflows require context + a signal.
  const strong = groups.some(g => !g.needsContext);
  if (!strong && (!context || !learning.length)) return null;
  const points = {
    topic: Math.min(36, keywords.length * 6), title: Math.min(24, titleHits * 8),
    learning: Math.min(20, learning.length * 5), community: priority ? 5 : 0,
    engagement: Math.min(10, Math.round(Math.log2(1 + Math.max(0, score) + Math.max(0, comments) * 2))),
    recency: Math.max(0, Math.round(5 * (1 - Math.max(0, now / 1000 - created) / (30 * 86400))))
  };
  return { categories: groups.map(g => g.category), matched_keywords: keywords,
    learning_signals: learning, quality_score: Object.values(points).reduce((a, b) => a + b, 0), quality_components: points };
}
/** Normalize only public t3 posts. No HTML/markdown renderer, user lookups or comment collection. */
export function normalizePost(child, source = null, now = Date.now()) {
  const d = child?.data;
  if (child?.kind !== "t3" || !d || typeof d.id !== "string" || !/^[a-z0-9]{1,16}$/.test(d.id)) return null;
  if (d.subreddit_type !== "public" || d.over_18 || d.quarantine || d.removed_by_category || d.promoted) return null;
  const title = clean(d.title, 400), body = clean(d.selftext, 12000), subreddit = clean(d.subreddit, 100);
  if (!title || !/^[A-Za-z0-9_]{2,50}$/.test(subreddit) || /^\[(deleted|removed)\]$/i.test(title) || /^\[(deleted|removed)\]$/i.test(body)) return null;
  const created = number(d.created_utc);
  if (created <= 0 || created > now / 1000 + 300) return null;
  const score = Math.trunc(number(d.score)), comments = Math.max(0, Math.trunc(number(d.num_comments)));
  const why = relevance(title, body, subreddit, score, comments, created, now);
  if (!why) return null;
  // Construct the destination, rather than trusting a remotely supplied href.
  const permalink = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${d.id}/`;
  const author = d.author === "[deleted]" ? null : clean(d.author, 100) || null;
  return { post_id: d.id, fullname: `t3_${d.id}`, title, subreddit, author,
    created_utc: created, score, num_comments: comments, permalink,
    url: safeExternalUrl(d.url_overridden_by_dest || d.url, permalink),
    excerpt: body.slice(0, LIMITS.excerptLength), is_self: Boolean(d.is_self),
    ...why, category: why.categories[0],
    matched_queries: source?.query ? [source.query] : [],
    matched_sources: source ? [source.id] : [],
    first_seen_at: new Date(now).toISOString(), fetched_at: new Date(now).toISOString(),
    verified_at: null };
}
/** The newer observation is authoritative, including decreasing scores and edited/deleted authors. */
export function mergePost(existing, latest) {
  if (!existing) return latest;
  return { ...latest, first_seen_at: existing.first_seen_at || latest.first_seen_at,
    categories: union(existing.categories, latest.categories),
    matched_keywords: union(existing.matched_keywords, latest.matched_keywords),
    matched_queries: union(existing.matched_queries, latest.matched_queries),
    matched_sources: union(existing.matched_sources, latest.matched_sources) };
}
export function deduplicate(posts) {
  const map = new Map();
  for (const p of posts) if (p?.post_id) map.set(p.post_id, mergePost(map.get(p.post_id), p));
  return [...map.values()];
}
export function retainPosts(posts, options, now = Date.now()) {
  const cutoff = now / 1000 - options.retentionDays * 86400;
  return posts.filter(p => p && /^[a-z0-9]{1,16}$/.test(p.post_id)
    && p.created_utc >= cutoff && p.created_utc <= now / 1000 + 300
    && Number.isFinite(Date.parse(p.verified_at))
    && Date.parse(p.verified_at) <= now + 300000
    && Date.parse(p.verified_at) + LIMITS.contentMaxAgeSeconds * 1000 > now)
    .sort((a, b) => b.created_utc - a.created_utc || a.post_id.localeCompare(b.post_id))
    .slice(0, options.maxPosts);
}
