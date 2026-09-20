# Validation summary — v1.0.1

Date: 2026-09-20. Reddit API: not configured.

This summary separates local tests, real runtime checks and deployed HTTPS checks. Raw operator logs, local filesystem paths and account details are not included in the public repository.

| Check | Result | Scope |
| --- | --- | --- |
| Dependency installation and lockfile | PASS | Node 24, npm 11, Wrangler 4.135.0; real generated lockfile; install audit reported 0 vulnerabilities. |
| Native Node tests | PASS | 73 passed, 0 failed, 0 skipped; synthetic data and explicit network/KV doubles. |
| Source checks and asset build | PASS | JavaScript syntax, Worker exports, conservative unsafe-DOM checks and production source/asset copy. |
| Wrangler dry-run | PASS | Actual bundle and Static Assets configuration validation. |
| Local workerd | PASS | Real Worker runtime, page/assets/health/status, authenticated missing-KV response and missing-API refresh state. |
| Local scheduled handler | PASS | Explicit safe skip with no Reddit credentials. |
| Cloudflare HTTPS checks | PASS | 29 checks: anonymous denial, wrong/correct key, signed Cookie attributes, same-origin controls, empty Feed KV reads, logout, CSP, no-store and no CORS. |
| Native browser on deployed HTTPS | PASS | Login, input clearing, reload/session persistence, disabled refresh, empty Feed, logout and locked state after reload; no browser script errors observed. |
| Key rotation | PASS | Old Cookie and old Bearer key returned 401 after a temporary rotation; intended key restored and HTTPS checks rerun. |
| Synthetic XSS rendering | PASS | Native browser with the local Node fixture harness; hostile strings rendered as text, no injected img/script nodes, populated Feed cleared after logout. Not a cloud-content test. |
| Cloud CPU sampling | PASS | 29 real invocations: 0–2 ms CPU, 0 exceptions; shell and empty Feed only. Maximum sampled wall time was 588 ms. |
| Legacy key check | PASS | Dedicated namespace was empty; no migration/deletion was needed. |
| Natural daily cloud Cron | NOT_RUN | Local scheduled invocation and deployed Cron configuration do not establish a natural scheduled execution. |
| Live Reddit API and full refresh CPU | NOT_RUN | No live OAuth, search, pagination, rate-header or content revalidation acceptance is claimed. |

The Node suite covers classification, normalization, provenance deduplication, decreasing engagement counts, filtering, 30-day/48-hour windows, bounded API retries/timeouts, pagination, partial failures, deletion revalidation, KV errors, auth, Origin controls and security headers. Mocked API tests do not establish live API behavior.

The earlier DOM bridge run is separate historical evidence; the results above refer to local/native/cloud acceptance. Detailed original reports remain in the operator's local archive.

## Reproduction

```sh
npm ci
npm run verify
npm run build:worker
npm run dev
```

Optional browser harnesses require Python Playwright and Chromium. They generate ignored local evidence, use only synthetic fixtures and do not call Reddit. Production runtime dependencies remain unchanged.
