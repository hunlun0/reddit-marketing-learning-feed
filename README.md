# Reddit Marketing Learning Feed

**Personal · Non-commercial · Read-only · Low volume**

A private, single-owner reading list for learning from public Reddit discussions about advertising platforms, measurement, campaign optimization, marketing tools, templates and workflows. It helps the owner find relevant discussions; the full conversation is always opened on Reddit.

Version **1.0.1**. **Reddit API: not configured.**

## Purpose and scope

The application is designed to retrieve public post metadata and short excerpts through Reddit's OAuth API. It does not post, comment, vote, message, fetch comment bodies, query user profiles, track people, create advertising audiences, redistribute a public feed, run an AI analysis service or train models.

The source code is public. Reading the deployed Feed and triggering a refresh require the owner's private key or signed session cookie. Without Reddit credentials, the dashboard remains available, manual refresh is disabled and scheduled refreshes safely skip.

## Architecture

```text
Browser → Cloudflare Worker → private Feed JSON from one KV namespace
               │
               ├─ native Static Assets
               ├─ signed session cookie / Bearer authentication
               └─ manual refresh or daily Cron
                    → OAuth token held in memory
                    → bounded searches and community listing
                    → classify, deduplicate and revalidate
                    → one bounded Feed snapshot in KV
```

One Worker, native Static Assets, one daily Cron and one KV namespace. Plain JavaScript ES modules and browser DOM APIs, with no runtime npm dependencies. No D1, Queues, Durable Objects, frontend framework, additional database or multi-user account system. Static assets pass through the Worker so security headers also apply to the page, CSS and JavaScript. Wrangler is a pinned development/deployment dependency.

## What the API is used for

| Request | Use |
| --- | --- |
| POST `https://www.reddit.com/api/v1/access_token` | Obtain an OAuth access token; no Reddit content is written. |
| GET `https://oauth.reddit.com/search` | Nine grouped searches for relevant learning topics. |
| GET `https://oauth.reddit.com/r/<combined-subreddits>/new` | One combined listing from selected public communities. |
| GET `https://oauth.reddit.com/api/info` | Revalidate retained posts and new candidates before storing them. |

Supported OAuth flows are confidential application-only `client_credentials` and an optional user-authorized refresh token with `read` scope. Use credentials and permissions appropriate for the intended use and follow [Reddit's API documentation and terms](docs/OFFICIAL_SOURCES.md). The dashboard is not an OAuth callback server.

Upstream hosts and read endpoints are allowlisted. There is no password grant, anonymous JSON fallback, RSS, scraping or mirror access. Credentials cannot select an arbitrary upstream URL or content-writing endpoint.

## Discovery and limits

The topics are Meta Ads, Google Ads, DV360 & Programmatic, TikTok Ads, Tracking & Analytics, Marketing Automation, Tools, Templates & Workflows, and Campaign Optimization. Global searches are supplemented by a combined listing from r/PPC, r/googleads, r/adops, r/programmatic and r/marketing.

- Each source has at most two pages of 50 posts, using `after` cursors.
- The initial time window is 30 days. Later complete refreshes use a 48-hour overlap; partial runs do not advance the complete checkpoint.
- Content matching determines categories independently of the search that found the post. Generic marketing terms alone do not qualify.
- Duplicate post IDs merge provenance; the latest verified text and engagement counts replace older values, including decreases.
- The optional 0–100 learning relevance score is an explainable sorting aid, not a quality or truth guarantee.
- Default storage is 400 posts, configurable within a 50–800 bound.

Requests are sequential and paced at 750 ms, with an eight-second request timeout, a 90-second client deadline, four shared retries and a total limit of 44 HTTP attempts including token requests and retries. A 403 never triggers an access workaround. At default settings, the calculated maximum before retries is 20 discovery calls, eight verification calls and one token call.

This is a bounded reading list, not exhaustive collection. Search indexing, result caps and conservative filtering can omit discussions. Edit `src/config.js` for topics, grouped queries, keywords and learning signals, then rerun the tests.

## Stored data and retention

Stored fields include post ID, title, subreddit, public author name when available, creation time, score, comment count, canonical Reddit permalink, safe destination URL, a plain-text excerpt of at most 600 characters, matching provenance, relevance components and fetch/verification timestamps. There is no full-body or comment archive.

Only posts explicitly marked as public are accepted. Unknown, private, restricted, NSFW, quarantined and removed content is conservatively excluded.

The 30-day window is based on post creation time. Cached copies expire no later than 48 hours after their last successful verification. Each refresh uses bounded `/api/info` batches to update edits and remove absent, deleted, removed or inaccessible posts. Failed verification never renews an old copy's verification time, and new candidates are not saved without verification.

| KV key | Content | Lifetime |
| --- | --- | --- |
| `feed:v2` | One bounded Feed snapshot | Earliest remaining post verification expiry, at most 48 hours |
| `attempt:v2` | Latest attempt metadata for cooldown | 24 hours; no post data |
| `run:v2` | Latest completion status and safe counters | Seven days; no post data |

Read-time and browser-time filtering also hide expired copies. A suspended browser tab or KV propagation can delay visible updates; this is not instant global deletion synchronization. Do not export or back up cached Reddit content. On a confirmed access revocation, deletion request or retirement, stop collection and remove cached content and obsolete credentials promptly.

KV is eventually consistent. Same-isolate protection and a 15-minute cooldown reduce overlap but do not provide distributed exactly-once execution. Manual refresh waits for the bounded operation; it is not a durable background queue. See [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

## Private access and security

Generate a random `REFRESH_KEY` with the project keygen. A successful login exchanges it for a seven-day signed `__Host-rmlf` cookie with `Secure; HttpOnly; SameSite=Strict; Path=/`. The cookie does not contain the raw key. Production requires HTTPS, and key rotation invalidates existing sessions.

The key input is cleared immediately. Keys and posts are not saved to localStorage or sessionStorage. Lock clears the browser session and displayed Feed. Browser mutations require the exact same origin; CLI Feed and refresh requests can use Bearer authentication.

Responses include CSP, no-store, nosniff, no-referrer and anti-framing headers. CORS is not enabled. The UI renders text with DOM APIs, and Reddit links use canonical HTTPS destinations. API query parameters are rejected so credentials cannot be supplied in URLs.

## Local development

Use Node 22 or newer with the pinned Wrangler dependency. The generated `package-lock.json` is committed for repeatable installation.

```sh
npm ci
npm run verify
npm run build:worker
npm run dev
```

`verify` runs source checks, 73 Node tests and the source/asset build. `build:worker` performs the actual Wrangler dry-run bundle. Deploy from the repository root, not `dist/`.

The zero-dependency offline harness uses in-memory KV and disables outbound fetch:

```sh
npm run dev:offline
# Optional synthetic UI data:
npm run dev:offline -- --fixture
```

The fixture page is explicitly labeled, and its test key is defined in `tests/helpers.js`. It is never used in production. The Node harness is not workerd.

Optional browser scripts require Python Playwright and an installed Chromium. Set `CHROMIUM_PATH` when needed. Generated evidence stays local and is ignored by Git.

```sh
python -X utf8 scripts/browser-smoke.py
python -X utf8 scripts/browser-dom-smoke.py
```

## Deployment and updates

`wrangler.jsonc` is the source of truth for the Worker, Static Assets, Cron and CACHE binding. The checked-in namespace ID is non-secret configuration; it grants no access. For maintenance of this deployment, retain the existing binding. For your own deployment, replace it with your own namespace rather than using another account's resource.

```sh
npx wrangler login
# Only if your deployment has no suitable dedicated namespace:
npx wrangler kv namespace create CACHE --binding CACHE --update-config
npm run keygen
npx wrangler secret put REFRESH_KEY
npm run deploy
```

Save the generated key in a password manager and paste it at the interactive Secret prompt. Never commit it or pass it in a command argument. Routine updates do not require creating another namespace or rotating the key.

For each code update, run `npm run verify` and `npm run build:worker`, deploy, then check the real HTTPS page and private access. The existing Worker URL and KV remain in use. See [the maintenance checklist](docs/CODEX_HANDOFF.md).

| Setting | Location | Purpose |
| --- | --- | --- |
| `REFRESH_KEY` | Cloudflare Secret | Private Feed access, login and manual refresh |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Cloudflare Secrets | OAuth client credentials |
| `REDDIT_REFRESH_TOKEN` | Optional Cloudflare Secret | User-authorized OAuth flow when applicable |
| `REDDIT_USER_AGENT` | Wrangler variable | Application/version and real Reddit contact username |
| `RETENTION_DAYS` | Wrangler variable | Default 30, clamped to 1–30 |
| `MAX_POSTS` | Wrangler variable | Default 400, clamped to 50–800 |
| `CACHE` | KV binding | Dedicated namespace |
| `ASSETS` | Static Assets binding | Files from `public/` |

Reddit integration is configured separately from routine deployment. Set a real contact username in the User-Agent and use interactive `wrangler secret put` for the relevant credentials. The placeholder User-Agent is intentionally rejected. If changing from refresh-token to application-only OAuth, remove the obsolete refresh-token Secret because it takes precedence. For local secrets, use the ignored `.dev.vars` file based on the empty example.

The daily Cron is `0 1 * * *`: 01:00 UTC / 09:00 Beijing. It safely skips when the Reddit API is not configured. With Wrangler running locally, test its scheduled handler at:

```sh
curl "http://localhost:8787/cdn-cgi/local/scheduled?format=json"
```

That local invocation does not prove a natural cloud Cron has run. Inspect an actual scheduled event separately.

An older deployment may contain `feed:v1` and `run:last` without TTL. Verify their ownership before deleting those two keys from the original namespace. Do not clear an entire namespace or import unverified old snapshots.

## Validation and operating limits

See [TEST_REPORT.md](TEST_REPORT.md) for the validation summary. Machine-specific logs and operator tools are kept outside the public source history. Existing evidence is not represented as a new test run.

Without credentials, `not_configured` is expected. `storage_missing` indicates that CACHE is unbound; `storage_unavailable` does not justify deleting existing data. Refresh failures do not advance the complete checkpoint, and failed KV reads abort before replacing an unknown snapshot.

Logs contain fixed event/error codes, source IDs and counts, not tokens, usernames, post text or upstream error bodies. Worker invocation logs are disabled in the configuration. Treat ad hoc tail output as private operational data.

Observed cloud CPU for the unconfigured shell and private empty Feed was 0–2 ms in 29 samples. This does not establish the cost of a full Reddit refresh. CPU is separate from network wall time; measure the configured workload against the actual [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [pricing](https://developers.cloudflare.com/workers/platform/pricing/). No additional Cloudflare service is required by this architecture.

## License

MIT for the application code. The license does not apply to Reddit content or replace Reddit's terms. Official references are listed in [docs/OFFICIAL_SOURCES.md](docs/OFFICIAL_SOURCES.md).
