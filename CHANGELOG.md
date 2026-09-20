# Changelog

## Public source maintenance — 2026-09-20

- Keep version 1.0.1, the existing Worker/KV binding and application behavior.
- Use a short API-not-configured status in the UI and documentation.
- Keep raw deployment evidence, local operator helpers and private backups out of public source history.
- Publish a concise validation summary and maintenance instructions; retain the resolved dependency lockfile.


## 1.0.1 — 2026-09-20

Reviewed successor to the supplied 1.0.0. Same personal/read-only purpose and Workers + Cron + KV architecture. No new Cloudflare service or runtime package dependency.

### Fixed

- Original `src/ui.js` contained nested unescaped template literals and failed ES-module syntax parsing. Replaced the embedded template with separate native static HTML/CSS/JS assets.
- Latest Reddit score, comment count, title, excerpt and deleted-author state now replace older values. They are no longer artificially held at all-time maxima.
- A failed or partial run no longer advances the last fully completed checkpoint. Unknown KV read failures do not silently replace existing data.
- Added pagination, bounded request bodies, request timeout, a client deadline, conservative pacing, rate-limit/reset handling, bounded retries, and one 401 token renewal.
- Missing Reddit credentials now produce an explicit safe state and a scheduled skip instead of throwing through the refresh path.
- Errors crossing API/log boundaries are fixed codes/messages rather than raw upstream response bodies.
- Numeric configuration is finite, bounded and validated; malformed stored records fail closed.
- Verification response schema failures are distinguished from an authoritative empty listing.

### Added

- Nine centrally configured, grouped global category searches plus one combined preferred-community listing, instead of 32 independent keyword searches.
- Exact provenance sets for categories, keywords, queries and source IDs, merged by post ID.
- Simple explainable learning relevance, with precise topic matching, contextual generic terms and Chinese phrase support.
- Daily revalidation of retained/candidate IDs, deletion handling, a 48-hour verification-age cap and KV expiration. No long-term content history.
- Private feed access using the existing REFRESH_KEY concept; seven-day signed HttpOnly/Secure/Strict cookies for the owner and Bearer support for CLI. No account database.
- Origin/CSRF checks, text-only rendering, canonical HTTPS Reddit destinations, CSP, no-store, no-referrer, no-frame and no public CORS.
- Same-isolate refresh guard and best-effort 15-minute KV cooldown. Separate attempt/completion metadata prevents rapid same-key writes; no distributed-lock claim.
- Mobile-first feed with newest/score/comments/relevance sorting, rolling 1/3/7/30-day windows, category/keyword/subreddit filters, text search and progressive rendering.
- Native Node unit/integration tests, an offline no-network harness, optional real-browser and DOM-only test scripts, review and operational handoff documents.

### Retained / deliberately not changed

- Worker name, JavaScript modules, MIT license, JSONC configuration format and `0 1 * * *` UTC Cron.
- Application-only OAuth with optional refresh-token support, according to the configured app and OAuth grant.
- A single small KV snapshot rather than a database. No D1, Queues, Durable Objects, framework, AI service or multi-user features.
- Manual HTTP refresh awaits completion; no misleading fire-and-forget 202 behavior was introduced.

### Breaking / migration notes

- `/api/feed` is now private. REFRESH_KEY must be random and at least 32 printable characters.
- Cookie-based browser requests require production HTTPS and same-origin use.
- Cached schema is `feed:v2`; old `feed:v1` and `run:last` must be removed from any previously used namespace. Do not migrate stale unverified content.
- The public `/api/config` endpoint is removed. Public `/api/status` exposes only non-sensitive configuration booleans/state.
- Default maximum retained posts is 400 instead of 800. No record survives indefinitely when refresh/revalidation stops.
- The User-Agent placeholder must be replaced with the real Reddit contact username before API access.
- Only `subreddit_type="public"` records are accepted in this conservative version; restricted/unknown types are excluded.
- Wrangler remains pinned; the resolved lockfile and local/runtime/HTTPS validation summary are included. See `TEST_REPORT.md`.
