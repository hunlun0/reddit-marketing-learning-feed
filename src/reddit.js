import { configuration, LIMITS } from "./config.js";
import { AppError } from "./errors.js";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_ORIGIN = "https://oauth.reddit.com";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** One bounded, sequential client per refresh. Tokens stay in memory only. */
export class RedditClient {
  constructor(env, { fetchImpl = fetch, now = Date.now, sleepImpl = sleep, limits = {} } = {}) {
    this.env = env; this.fetchImpl = fetchImpl; this.now = now; this.sleep = sleepImpl;
    this.limits = { ...LIMITS, ...limits }; this.started = now();
    this.requests = 0; this.retries = 0; this.token = null; this.authRetried = false;
    this.nextRequestAt = 0; this.blockedUntil = 0;
    const state = configuration(env).state;
    if (state !== "configured") throw new AppError(state, 503);
  }
  async wait(ms) {
    if (this.now() + ms >= this.started + this.limits.refreshDeadlineMs) throw new AppError("deadline");
    if (ms > 0) await this.sleep(ms);
  }
  async readJSON(response) {
    if (Number(response.headers.get("Content-Length")) > MAX_BODY_BYTES) { await response.body?.cancel(); throw new AppError("invalid_response"); }
    if (!response.body) throw new AppError("invalid_response");
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new AppError("invalid_response"); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { if (e instanceof AppError) throw e; throw new AppError("invalid_response"); }
  }
  readRateLimit(headers) {
    // Missing headers must not be interpreted as zero remaining requests.
    const remaining = headers.get("x-ratelimit-remaining"), reset = headers.get("x-ratelimit-reset");
    if (remaining !== null && reset !== null && Number.isFinite(Number(remaining)) && Number.isFinite(Number(reset)) && Number(remaining) < 1) {
      this.blockedUntil = Math.max(this.blockedUntil, this.now() + Math.max(1, Number(reset)) * 1000);
    }
  }
  retryDelay(headers) {
    const raw = headers.get("retry-after");
    let seconds = raw === null ? NaN : Number(raw);
    if (!Number.isFinite(seconds) && raw) seconds = (Date.parse(raw) - this.now()) / 1000;
    const resetRaw = headers.get("x-ratelimit-reset");
    const reset = resetRaw === null ? 0 : Number(resetRaw);
    return Math.max(1000, (Number.isFinite(seconds) ? seconds : 2) * 1000,
      Number.isFinite(reset) ? reset * 1000 : 0);
  }
  async wire(url, init, { tokenRequest = false } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.requests >= this.limits.maxRequests) throw new AppError("budget_exhausted");
      const delay = Math.max(0, this.nextRequestAt - this.now(), this.blockedUntil - this.now());
      if (this.blockedUntil >= this.started + this.limits.refreshDeadlineMs) throw new AppError("rate_limited", 429);
      await this.wait(delay);
      const remaining = this.started + this.limits.refreshDeadlineMs - this.now();
      if (remaining <= 0) throw new AppError("deadline");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(this.limits.requestTimeoutMs, remaining));
      this.requests++; this.nextRequestAt = this.now() + this.limits.requestSpacingMs;
      let error, retryMs = 1000;
      try {
        const response = await this.fetchImpl(url, { ...init, redirect: "error", signal: controller.signal });
        this.readRateLimit(response.headers);
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 429) { retryMs = this.retryDelay(response.headers); this.blockedUntil = Math.max(this.blockedUntil, this.now() + retryMs); throw new AppError("rate_limited", 429); }
          if (response.status === 401 || (tokenRequest && response.status === 400)) throw new AppError("auth_failed", 401);
          if (response.status === 403) throw new AppError("access_denied", 403);
          throw new AppError(response.status >= 500 ? "upstream_error" : "invalid_response");
        }
        return await this.readJSON(response);
      } catch (e) {
        error = controller.signal.aborted ? new AppError("timeout") : e instanceof AppError ? e : new AppError("upstream_error");
      } finally { clearTimeout(timer); }
      const retryable = ["upstream_error", "timeout", "rate_limited"].includes(error.code);
      if (!retryable || attempt === 1 || this.retries >= this.limits.maxRetries) throw error;
      this.retries++;
      if (this.now() + retryMs >= this.started + this.limits.refreshDeadlineMs) throw error;
      await this.wait(retryMs);
    }
    throw new AppError("upstream_error");
  }
  async authenticate() {
    const form = new URLSearchParams();
    if (this.env.REDDIT_REFRESH_TOKEN?.trim()) {
      form.set("grant_type", "refresh_token"); form.set("refresh_token", this.env.REDDIT_REFRESH_TOKEN.trim());
    } else form.set("grant_type", "client_credentials");
    // Reddit-issued client credentials are ASCII. Never log this header or the response body.
    let basic;
    try { basic = btoa(`${this.env.REDDIT_CLIENT_ID.trim()}:${this.env.REDDIT_CLIENT_SECRET.trim()}`); }
    catch { throw new AppError("auth_failed", 401); }
    const data = await this.wire(TOKEN_URL, { method: "POST", headers: {
      Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": this.env.REDDIT_USER_AGENT }, body: form.toString() }, { tokenRequest: true });
    if (typeof data.access_token !== "string" || !data.access_token || data.access_token.length > 4096 || String(data.token_type).toLowerCase() !== "bearer") throw new AppError("auth_failed", 401);
    this.token = data.access_token;
  }
  async get(path, params = {}) {
    if (!/^\/(?:search|api\/info|r\/[A-Za-z0-9_+]+\/new)$/.test(path)) throw new AppError("bad_request", 400);
    if (!this.token) await this.authenticate();
    const url = new URL(path, API_ORIGIN);
    for (const [k, value] of Object.entries({ raw_json: 1, ...params })) if (value !== undefined && value !== null) url.searchParams.set(k, String(value));
    const request = () => this.wire(url.href, { method: "GET", headers: {
      Authorization: `Bearer ${this.token}`, "User-Agent": this.env.REDDIT_USER_AGENT } });
    let data;
    try { data = await request(); }
    catch (error) {
      if (error.code !== "auth_failed" || this.authRetried) throw error;
      this.authRetried = true; await this.authenticate(); data = await request();
    }
    if (data?.kind !== "Listing" || !Array.isArray(data?.data?.children)
      || !["string", "undefined"].includes(typeof data.data.after) && data.data.after !== null) throw new AppError("invalid_response");
    return data.data;
  }
  async info(ids) {
    if (!ids.length || ids.length > LIMITS.verificationBatchSize || ids.some(id => !/^[a-z0-9]{1,16}$/.test(id))) throw new AppError("bad_request", 400);
    const children = (await this.get("/api/info", { id: ids.map(id => `t3_${id}`).join(",") })).children;
    // A malformed verification batch is NOT evidence that all requested posts were deleted.
    if (children.some(c => c?.kind !== "t3" || !c.data || !/^[a-z0-9]{1,16}$/.test(c.data.id || "")
      || typeof c.data.title !== "string" || typeof c.data.subreddit !== "string" || typeof c.data.subreddit_type !== "string")) throw new AppError("invalid_response");
    return children;
  }
  /** Yield each page before fetching the next: a later failure does not erase earlier pages. */
  async *discover(source, cutoff) {
    const ageDays = Math.max(0, (this.now() / 1000 - cutoff) / 86400);
    const t = ageDays < 1 ? "day" : ageDays < 7 ? "week" : "month";
    let after = null; const seen = new Set();
    for (let page = 0; page < this.limits.pagesPerSearch; page++) {
      const listing = await this.get(source.path, { q: source.query || undefined,
        sort: source.query ? "new" : undefined, t: source.query ? t : undefined,
        limit: this.limits.pageSize, after, count: page * this.limits.pageSize });
      yield listing.children;
      const dates = listing.children.map(c => Number(c?.data?.created_utc));
      if (!listing.children.length || !listing.after || seen.has(listing.after)
        || (dates.every(d => Number.isFinite(d) && d > 0) && dates.every(d => d < cutoff))) break;
      if (!/^t3_[a-z0-9]{1,16}$/.test(listing.after)) throw new AppError("invalid_response");
      seen.add(listing.after); after = listing.after;
    }
  }
}
