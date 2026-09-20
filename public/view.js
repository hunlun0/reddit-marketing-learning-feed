/** Shared, pure browser filtering helpers (also tested using Node). No network or DOM dependencies. */
export function redditLink(post) {
  if (!/^[a-z0-9]{1,16}$/.test(post?.post_id || "") || !/^[A-Za-z0-9_]{2,50}$/.test(post?.subreddit || "")) return null;
  return `https://www.reddit.com/r/${encodeURIComponent(post.subreddit)}/comments/${post.post_id}/`;
}
export function filterPosts(posts, filters = {}, now = Date.now()) {
  const days = [1, 3, 7, 30].includes(Number(filters.days)) ? Number(filters.days) : 30;
  const cutoff = now / 1000 - days * 86400, search = String(filters.search || "").trim().toLocaleLowerCase().slice(0, 200);
  const selected = posts.filter(p => p.created_utc >= cutoff && p.created_utc <= now / 1000 + 300
    && Date.parse(p.verified_at) + 48 * 3600 * 1000 > now
    && (!filters.category || p.categories.includes(filters.category))
    && (!filters.keyword || p.matched_keywords.includes(filters.keyword))
    && (!filters.subreddit || p.subreddit === filters.subreddit)
    && (!search || `${p.title} ${p.excerpt}`.toLocaleLowerCase().includes(search)));
  const sort = filters.sort;
  return selected.sort((a, b) => (sort === "score" ? b.score - a.score : sort === "comments" ? b.num_comments - a.num_comments : sort === "quality" ? (b.quality_score || 0) - (a.quality_score || 0) : 0)
    || b.created_utc - a.created_utc || a.post_id.localeCompare(b.post_id));
}
export function filterOptions(posts) {
  const sorted = values => [...new Set(values)].sort((a, b) => a.localeCompare(b));
  return { category: sorted(posts.flatMap(p => p.categories)), keyword: sorted(posts.flatMap(p => p.matched_keywords)), subreddit: sorted(posts.map(p => p.subreddit)) };
}
