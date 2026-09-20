/** Only these fixed, non-sensitive codes/messages may cross the API/log boundary. */
const MESSAGES = {
  not_configured: "Reddit API not configured.",
  invalid_user_agent: "Set REDDIT_USER_AGENT to include your real Reddit contact username.",
  storage_missing: "KV binding CACHE is not configured. The dashboard is available without it.",
  storage_unavailable: "Storage is temporarily unavailable. No successful save was confirmed.",
  storage_invalid: "Stored feed format is invalid. Inspect storage before replacing data.",
  unauthorized: "Unlock with your private REFRESH_KEY.",
  key_missing: "Set a random REFRESH_KEY of at least 32 characters to enable private access.",
  forbidden: "This request is not allowed.",
  bad_request: "Invalid request.",
  auth_failed: "Reddit authentication failed. Check credentials and OAuth grant.",
  access_denied: "Reddit denied access. Check credentials and API permissions.",
  rate_limited: "Reddit rate limit reached. The next scheduled run can retry.",
  upstream_error: "Reddit is temporarily unavailable.",
  invalid_response: "Reddit returned an unexpected response.",
  timeout: "The Reddit request timed out.",
  budget_exhausted: "The refresh request budget was reached.",
  deadline: "The bounded refresh time was reached.",
  busy: "A refresh is running or the 15-minute refresh cooldown is active.",
  not_found: "Not found.",
  method_not_allowed: "Method not allowed.",
  internal_error: "The request could not be completed. Check Cloudflare logs."
};
export class AppError extends Error {
  constructor(code, status = 503, retryAfter = null) {
    super(MESSAGES[code] || MESSAGES.internal_error);
    this.name = "AppError"; this.code = code in MESSAGES ? code : "internal_error";
    this.status = status; this.retryAfter = retryAfter;
  }
}
export function safeError(error) {
  return error instanceof AppError ? error : new AppError("internal_error", 500);
}
export function log(event, fields = {}) {
  // Callers supply only numeric counters, run IDs, predefined query IDs and error codes.
  console.log(JSON.stringify({ event, ...fields }));
}
