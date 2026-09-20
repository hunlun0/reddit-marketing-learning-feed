import { configuration, settings } from "./config.js";
import { authorize, checkOrigin, clearCookie, keyConfigured, sessionCookie } from "./auth.js";
import { AppError, log, safeError } from "./errors.js";
import { loadFeed, loadRun } from "./storage.js";
import { refresh } from "./refresh.js";

export const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Cache-Control": "no-store, private", "Cross-Origin-Resource-Policy": "same-origin"
};
function secured(response) {
  const headers = new Headers(response.headers);
  for (const [k, value] of Object.entries(SECURITY_HEADERS)) headers.set(k, value);
  // We never enable CORS on private feed or authentication routes.
  headers.delete("Access-Control-Allow-Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
function method(request, expected) { if (request.method !== expected) throw new AppError("method_not_allowed", 405); }
export function makeWorker({ refreshImpl = refresh, logger = log } = {}) {
  return {
    async fetch(request, env, ctx) {
      try {
        const url = new URL(request.url), path = url.pathname;
        if (path.startsWith("/api/") && url.search) throw new AppError("bad_request", 400); // No secrets/remote URLs in query strings.
        let response;
        switch (path) {
          case "/health":
            method(request, "GET"); response = json({ ok: true }); break;
          case "/api/status":
            method(request, "GET"); response = json({ reddit: configuration(env).state,
              private_access: keyConfigured(env), storage_configured: Boolean(env.CACHE) }); break;
          case "/api/session":
            method(request, "POST"); await authorize(request, env, { mutation: true, bearerOnly: true });
            response = json({ ok: true }, 200, { "Set-Cookie": await sessionCookie(env) }); break;
          case "/api/logout":
            method(request, "POST"); checkOrigin(request, true);
            response = json({ ok: true }, 200, { "Set-Cookie": clearCookie() }); break;
          case "/api/feed": {
            method(request, "GET"); await authorize(request, env);
            const feed = await loadFeed(env); let last_run = null, status_warning = null;
            try { last_run = await loadRun(env); } catch { status_warning = "storage_unavailable"; }
            response = json({ ...feed, last_run, status_warning, settings: settings(env), reddit: configuration(env).state }); break;
          }
          case "/api/refresh": {
            method(request, "POST"); await authorize(request, env, { mutation: true });
            // Await completion. A 202 + waitUntil-only job would be cut off after 30 seconds.
            const task = refreshImpl(env, { trigger: "manual" });
            ctx?.waitUntil?.(task.catch(() => {}));
            const result = await task;
            response = json(result, result.status === "failed" ? 503 : result.status === "not_configured" ? 409 : 200); break;
          }
          default: {
            if (!["GET", "HEAD"].includes(request.method)) throw new AppError("method_not_allowed", 405);
            if (!["/", "/index.html", "/app.js", "/view.js", "/styles.css", "/robots.txt"].includes(path)) throw new AppError("not_found", 404);
            if (!env.ASSETS) throw new AppError("internal_error", 503);
            response = await env.ASSETS.fetch(request);
          }
        }
        return secured(response);
      } catch (error) {
        const safe = safeError(error);
        if (safe.status >= 500) logger("request_failed", { code: safe.code });
        return secured(json({ error: safe.code, message: safe.message }, safe.status,
          safe.retryAfter ? { "Retry-After": String(safe.retryAfter) } : {}));
      }
    },
    async scheduled(controller, env, ctx) {
      const task = refreshImpl(env, { trigger: "cron" });
      ctx?.waitUntil?.(task);
      // Let a real failed refresh surface as an error in Cron observability.
      const result = await task;
      if (result.status === "failed") throw new AppError("upstream_error");
    }
  };
}
export default makeWorker();
