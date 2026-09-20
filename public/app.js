import { filterOptions, filterPosts, redditLink } from "/view.js";
const $ = id => document.getElementById(id);
let posts = [], visible = 40, status = {}, refreshing = false;
const defaults = { search: "", sort: "newest", days: "30", category: "", keyword: "", subreddit: "" };
const message = text => { $("message").textContent = text; };
function node(tag, text, className) { const n = document.createElement(tag); if (text !== undefined) n.textContent = String(text); if (className) n.className = className; return n; }
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
  let data; try { data = await response.json(); } catch { throw new Error("The server could not be reached. Your current reading list has not been replaced."); }
  if (!response.ok) {
    const e = new Error(data.message || (data.status === "failed" ? "Refresh failed. Previously verified posts remain available until expiry." : data.code === "not_configured" ? "Reddit API not configured." : "The request did not complete."));
    e.code = data.error || data.code; e.status = response.status; throw e;
  }
  return data;
}
async function serviceStatus() {
  status = await api("/api/status");
  $("service-status").textContent = status.reddit === "not_configured" ? "Reddit API not configured."
    : status.reddit === "invalid_user_agent" ? "Reddit credentials are present. Set REDDIT_USER_AGENT to include your real Reddit username."
    : "Reddit API configured.";
  if (!status.private_access) message("Set a random REFRESH_KEY of at least 32 characters to enable private access.");
  else if (!status.storage_configured) message("The dashboard is ready. Bind a KV namespace named CACHE before the first refresh.");
  $("refresh").disabled = status.reddit !== "configured" || !status.storage_configured;
}
function fillOptions() {
  const options = filterOptions(posts), labels = { category: "All categories", keyword: "All keywords", subreddit: "All subreddits" };
  for (const id of Object.keys(options)) {
    const previous = $(id).value, first = node("option", labels[id]); first.value = "";
    const children = [first, ...options[id].map(v => { const n = node("option", id === "subreddit" ? "r/" + v : v); n.value = v; return n; })];
    $(id).replaceChildren(...children); if (options[id].includes(previous)) $(id).value = previous;
  }
}
function card(p) {
  const article = node("article", undefined, "post"), meta = node("div", undefined, "meta");
  const time = node("time", new Date(p.created_utc * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
  time.dateTime = new Date(p.created_utc * 1000).toISOString();
  meta.append(node("span", "r/" + p.subreddit), time, node("span", `${p.score} score`), node("span", `${p.num_comments} comments`));
  const href = redditLink(p), heading = node("h3"), link = node("a", p.title);
  if (href) { link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer"; }
  heading.append(link); const tags = node("div", undefined, "tags");
  for (const category of p.categories) tags.append(node("span", category, "tag"));
  article.append(meta, heading, tags);
  if (p.excerpt) article.append(node("p", p.excerpt, "excerpt"));
  article.append(node("p", "Matched: " + p.matched_keywords.join(" · "), "keywords"));
  const detail = node("details"), list = node("ul");
  detail.append(node("summary", `Why this post · learning relevance ${p.quality_score || 0}/100`));
  for (const text of ["Learning signals: " + (p.learning_signals || []).join(", "),
    "Sources: " + p.matched_sources.join(", "), ...p.matched_queries.map(q => "Query: " + q),
    "Last verified: " + new Date(p.verified_at).toLocaleString()]) list.append(node("li", text));
  detail.append(list); article.append(detail);
  if (href) { const open = node("a", "Open Reddit ↗", "open"); open.href = href; open.target = "_blank"; open.rel = "noopener noreferrer"; article.append(open); }
  return article;
}
function render() {
  const filters = Object.fromEntries(Object.keys(defaults).map(id => [id, $(id).value]));
  const selected = filterPosts(posts, filters);
  const fragment = document.createDocumentFragment(); for (const p of selected.slice(0, visible)) fragment.append(card(p));
  $("posts").replaceChildren(fragment);
  $("count").textContent = `${selected.length} matching posts · ${Math.min(selected.length, visible)} shown`;
  $("more").hidden = selected.length <= visible; $("empty").hidden = selected.length !== 0;
  $("empty").textContent = posts.length ? "No posts match these filters. Try a wider time window or reset filters."
    : status.reddit === "configured" ? "No verified posts yet. Refresh to load recent discussions."
    : "No posts to display.";
}
async function loadFeed() {
  try {
    const data = await api("/api/feed"); posts = data.posts; visible = 40;
    $("unlock-panel").hidden = true; $("feed-panel").hidden = false;
    const formatTime = value => value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never";
    const updated = formatTime(data.updated_at), complete = formatTime(data.last_complete_at);
    $("updated").textContent = `Last saved: ${updated} · Last fully completed: ${complete}`;
    if (data.last_run?.status === "failed" || data.last_run?.status === "partial") message(`Last refresh: ${data.last_run.status}. Some results may be missing. Previously verified posts expire within 48 hours without re-verification.`);
    if (data.status_warning) message("The reading list loaded, but refresh-status storage is temporarily unavailable.");
    fillOptions(); render();
  } catch (e) {
    if (["unauthorized", "key_missing"].includes(e.code)) { clearFeed(); $("unlock-panel").hidden = !status.private_access; }
    else { message(e.message); render(); }
  }
}
function clearFeed() { posts = []; $("posts").replaceChildren(); $("feed-panel").hidden = true; }
$("unlock-form").addEventListener("submit", async event => {
  event.preventDefault(); $("unlock").disabled = true;
  let accessKey = $("key").value; $("key").value = "";
  try { await api("/api/session", { method: "POST", headers: { Authorization: `Bearer ${accessKey}` } }); accessKey = ""; message(""); await loadFeed(); }
  catch (e) { message(e.message); } finally { accessKey = ""; $("unlock").disabled = false; }
});
$("logout").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); clearFeed(); $("unlock-panel").hidden = false; message("Feed locked."); }
  catch (e) { message(e.message); }
});
$("refresh").addEventListener("click", async () => {
  if (refreshing) return; refreshing = true; $("refresh").disabled = true; $("refresh").textContent = "Refreshing…";
  message("Refreshing Reddit sources. Keep this page open until it completes.");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 110000);
  try { const data = await api("/api/refresh", { method: "POST", signal: controller.signal });
    message(`Refresh ${data.status}: ${data.new_posts || 0} new posts, ${data.saved_posts || 0} saved, ${data.failures || 0} failures.`); await loadFeed(); }
  catch (e) { message(e.name === "AbortError" ? "The request was interrupted. A successful save has not been confirmed; reload later to check status." : e.message); }
  finally { clearTimeout(timer); refreshing = false; $("refresh").textContent = "Refresh Reddit"; $("refresh").disabled = status.reddit !== "configured" || !status.storage_configured; }
});
$("filters").addEventListener("submit", e => e.preventDefault());
for (const id of Object.keys(defaults)) $(id).addEventListener(id === "search" ? "input" : "change", () => { visible = 40; render(); });
$("clear-filters").addEventListener("click", () => { for (const [id, value] of Object.entries(defaults)) $(id).value = value; visible = 40; render(); });
$("more").addEventListener("click", () => { visible += 40; render(); });
// Expire displayed copies even when the tab remains open. Never persist Reddit content in browser storage.
setInterval(() => { posts = posts.filter(p => Date.parse(p.verified_at) + 48 * 3600 * 1000 > Date.now()); if (!$("feed-panel").hidden) render(); }, 60000);
window.addEventListener("pageshow", async event => { if (event.persisted) { clearFeed(); await loadFeed(); } });
try { await serviceStatus(); if (status.private_access) await loadFeed(); }
catch (e) { message(e.message); }
