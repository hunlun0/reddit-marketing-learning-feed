/** All discovery queries, topic matching and learning signals live here.
 * One combined search per category, NOT one request per keyword.
 * Query strings are Reddit syntax; keywords are local literal phrase matches.
 */
export const PRIORITY_SUBREDDITS = ["PPC", "googleads", "adops", "programmatic", "marketing"];
export const SEARCH_GROUPS = [
  { id: "meta", category: "Meta Ads",
    query: '("Meta Ads" OR "Facebook Ads" OR "Instagram Ads" OR "paid social")',
    keywords: ["meta ads", "facebook ads", "instagram ads", "paid social"] },
  { id: "google", category: "Google Ads",
    query: '("Google Ads" OR "AdWords" OR "PMax" OR "Performance Max" OR "YouTube Ads" OR "paid search" OR "PPC")',
    keywords: ["google ads", "adwords", "pmax", "performance max", "youtube ads", "paid search", "ppc"] },
  { id: "programmatic", category: "DV360 & Programmatic",
    query: '("DV360" OR "Display Video 360" OR "Display & Video 360" OR "programmatic advertising" OR "media buying")',
    keywords: ["dv360", "display video 360", "display & video 360", "programmatic", "media buying"] },
  { id: "tiktok", category: "TikTok Ads",
    query: '("TikTok Ads" OR "TikTok advertising" OR "Spark Ads")',
    keywords: ["tiktok ads", "tiktok advertising", "spark ads"] },
  { id: "tracking", category: "Tracking & Analytics",
    query: '("GA4" OR "Google Analytics 4" OR "Google Tag Manager" OR "conversion tracking" OR "server-side tagging" OR "conversions API" OR ("attribution" AND ("ads" OR "PPC" OR "marketing" OR "campaign")))',
    keywords: ["ga4", "google analytics 4", "google tag manager", "conversion tracking", "server-side tagging", "conversions api"],
    contextKeywords: ["gtm", "attribution", "capi"] },
  { id: "automation", category: "Marketing Automation",
    query: '("marketing automation" OR "advertising API" OR "Google Ads API" OR "Meta Marketing API" OR "campaign automation" OR "automated reporting")',
    keywords: ["marketing automation", "advertising api", "google ads api", "meta marketing api", "marketing api", "campaign automation", "automated reporting"] },
  { id: "tools", category: "Tools",
    query: '("tool" OR "tools" OR "AI" OR "dashboard") AND ("PPC" OR "paid media" OR "Google Ads" OR "Meta Ads" OR "marketing automation")',
    keywords: ["tool", "tools", "ai", "dashboard"], needsContext: true },
  { id: "templates", category: "Templates & Workflows",
    query: '("template" OR "workflow" OR "media plan" OR "campaign audit" OR "checklist" OR "playbook") AND ("ads" OR "PPC" OR "paid media" OR "marketing")',
    keywords: ["template", "templates", "workflow", "workflows", "media plan", "campaign audit", "checklist", "playbook"], needsContext: true },
  { id: "optimization", category: "Campaign Optimization",
    query: '(("optimization" OR "optimisation" OR "troubleshooting" OR "case study" OR "bid strategy" OR "creative testing") AND ("ads" OR "PPC" OR "paid media" OR "campaign")) OR "广告优化" OR "投放优化"',
    keywords: ["optimization", "optimisation", "troubleshooting", "case study", "bid strategy", "creative testing", "roas", "广告优化", "投放优化"], needsContext: true }
];
export const CONTEXT_TERMS = ["ads", "advertising", "ppc", "paid media", "campaign", "media buying", "marketing automation", "投放", "广告"];
export const LEARNING_SIGNALS = [
  { label: "Tools & automation", terms: ["tool", "tools", "automation", "api", "script", "automated"] },
  { label: "Practical experience", terms: ["case study", "experiment", "tested", "results", "lessons", "guide", "how to", "实操", "案例"] },
  { label: "Platform changes", terms: ["update", "changes", "new feature", "deprecated", "rollout"] },
  { label: "Templates & workflows", terms: ["template", "templates", "workflow", "checklist", "playbook", "media plan", "audit"] },
  { label: "Measurement", terms: ["tracking", "attribution", "measurement", "ga4", "reporting"] },
  { label: "Troubleshooting & optimization", terms: ["optimization", "optimisation", "troubleshooting", "fix", "issue", "help", "why", "roas", "cpc", "ctr", "优化"] }
];
export const LIMITS = Object.freeze({
  pageSize: 50, pagesPerSearch: 2, maxRequests: 44, maxRetries: 4,
  requestTimeoutMs: 8000, refreshDeadlineMs: 90000, requestSpacingMs: 750,
  cooldownSeconds: 900, verificationBatchSize: 100,
  contentMaxAgeSeconds: 48 * 3600, excerptLength: 600
});
export function searchPlan() {
  return [
    ...SEARCH_GROUPS.map(g => ({ id: g.id, category: g.category, query: g.query, path: "/search" })),
    // A small public community listing catches practical titles without platform names.
    { id: "communities", category: null, query: null,
      path: `/r/${PRIORITY_SUBREDDITS.join("+")}/new` }
  ];
}
export function boundedInteger(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
export function settings(env = {}) {
  return { retentionDays: boundedInteger(env.RETENTION_DAYS, 30, 1, 30),
    maxPosts: boundedInteger(env.MAX_POSTS, 400, 50, 800) };
}
export function configuration(env = {}) {
  const credentials = Boolean(env.REDDIT_CLIENT_ID?.trim() && env.REDDIT_CLIENT_SECRET?.trim());
  const ua = env.REDDIT_USER_AGENT || "";
  const userAgentValid = /^[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+:v[^\s]+ \(by \/u\/[A-Za-z0-9_-]{3,20}\)$/.test(ua)
    && !/YOUR_|EXAMPLE|REPLACE/i.test(ua);
  return { credentials, userAgentValid,
    state: !credentials ? "not_configured" : !userAgentValid ? "invalid_user_agent" : "configured" };
}
