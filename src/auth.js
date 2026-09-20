import { AppError } from "./errors.js";
const COOKIE = "__Host-rmlf", SESSION_SECONDS = 7 * 86400;
const encoder = new TextEncoder();
export function keyConfigured(env) { return typeof env.REFRESH_KEY === "string" && /^[\x21-\x7e]{32,256}$/.test(env.REFRESH_KEY); }
function key(env) { if (!keyConfigured(env)) throw new AppError("key_missing", 503); return env.REFRESH_KEY; }
async function importKey(value) { return crypto.subtle.importKey("raw", encoder.encode(value), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }
const hex = buffer => [...new Uint8Array(buffer)].map(v => v.toString(16).padStart(2, "0")).join("");
const unhex = text => Uint8Array.from(text.match(/../g) || [], v => parseInt(v, 16));
async function equalSecret(expected, received) {
  if (typeof received !== "string" || received.length < 32 || received.length > 256) return false;
  // Native HMAC verification avoids naive secret string comparison.
  const message = encoder.encode("rmlf-key-check-v1");
  const signature = await crypto.subtle.sign("HMAC", await importKey(received), message);
  return crypto.subtle.verify("HMAC", await importKey(expected), signature, message);
}
export function checkOrigin(request, required = true) {
  const origin = request.headers.get("Origin");
  if ((required && !origin) || (origin && origin !== new URL(request.url).origin)) throw new AppError("forbidden", 403);
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") throw new AppError("forbidden", 403);
}
export async function authorize(request, env, { mutation = false, bearerOnly = false, now = Date.now() } = {}) {
  const secret = key(env), authorization = request.headers.get("Authorization");
  if (authorization !== null) {
    if (authorization.length > 512 || !authorization.startsWith("Bearer ") || !await equalSecret(secret, authorization.slice(7))) throw new AppError("unauthorized", 401);
    if (mutation) checkOrigin(request, false); // CLI without Origin is allowed; cross-origin browsers are not.
    return "bearer";
  }
  if (bearerOnly) throw new AppError("unauthorized", 401);
  const cookie = request.headers.get("Cookie") || "";
  if (cookie.length > 8192) throw new AppError("unauthorized", 401);
  const value = cookie.split(";").map(c => c.trim()).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const match = value?.match(/^v1\.(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/);
  if (!match || Number(match[1]) * 1000 <= now || Number(match[1]) * 1000 > now + SESSION_SECONDS * 1000 + 1000) throw new AppError("unauthorized", 401);
  const payload = `v1.${match[1]}.${match[2]}`;
  if (!await crypto.subtle.verify("HMAC", await importKey(secret), unhex(match[3]), encoder.encode(payload))) throw new AppError("unauthorized", 401);
  if (mutation) checkOrigin(request, true);
  return "cookie";
}
export async function sessionCookie(env, now = Date.now()) {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `v1.${Math.floor(now / 1000) + SESSION_SECONDS}.${nonce}`;
  const signature = hex(await crypto.subtle.sign("HMAC", await importKey(key(env)), encoder.encode(payload)));
  return `${COOKIE}=${payload}.${signature}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
