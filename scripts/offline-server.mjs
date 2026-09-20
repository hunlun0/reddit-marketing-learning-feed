/** Dependency-free Node harness, NOT the Cloudflare runtime. Binds loopback only.
 * Never loads .dev.vars, never reads Reddit credentials, never permits outbound fetch.
 * --fixture injects explicitly synthetic test data; these fixtures are not in Worker assets.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname } from "node:path";
import worker from "../src/index.js";
import { FEED_KEY } from "../src/storage.js";
import { KEY, MemoryKV, stored } from "../tests/helpers.js";
const fixture = process.argv.includes("--fixture");
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local port");
globalThis.fetch = async () => { throw new Error("Outbound fetch is disabled in the offline harness"); };
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain" };
const env = {
  ...(fixture ? { REFRESH_KEY: KEY } : process.env.REFRESH_KEY ? { REFRESH_KEY: process.env.REFRESH_KEY } : {}),
  CACHE: new MemoryKV(),
  ASSETS: { async fetch(request) {
    const path = new URL(request.url).pathname === "/" ? "/index.html" : new URL(request.url).pathname;
    if (!["/index.html", "/app.js", "/view.js", "/styles.css", "/robots.txt"].includes(path)) return new Response("Not found", { status: 404 });
    try {
      let data = await readFile(fileURLToPath(new URL("../public" + path, import.meta.url)));
      if (fixture && path === "/index.html") data = Buffer.from(data.toString().replace("<main>", '<main><p class="notice">LOCAL SYNTHETIC TEST DATA — not fetched from Reddit.</p>'));
      return new Response(request.method === "HEAD" ? null : data, { headers: { "Content-Type": MIME[extname(path)] + "; charset=utf-8" } });
    } catch { return new Response("Not found", { status: 404 }); }
  } }
};
if (fixture) {
  const now = Date.now();
  const posts = Array.from({ length: 45 }, (_, i) => stored("fixture" + i, { title: `Synthetic Google Ads workflow ${i + 1}`, created_utc: now / 1000 - (i + 1) * 3600, score: i * 3, num_comments: 100 - i }, now));
  posts[0].title = 'Google Ads <img src=x onerror="window.XSS_EXECUTED=true">';
  posts[0].excerpt = '<script>window.XSS_EXECUTED=true</script> This is a synthetic XSS safety test, not a Reddit post.';
  posts[0].permalink = "javascript:alert('unsafe upstream link')";
  env.CACHE.seed(FEED_KEY, { version: 2, posts, updated_at: new Date(now).toISOString(), last_complete_at: new Date(now).toISOString() });
}
const server = createServer(async (incoming, outgoing) => {
  try {
    if (!incoming.url?.startsWith("/") || incoming.url.startsWith("//")) { outgoing.writeHead(400).end(); return; }
    const headers = new Headers(); for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(",") : value);
    const request = new Request(`http://127.0.0.1:${port}${incoming.url}`, { method: incoming.method, headers });
    incoming.resume();
    const tasks = [], response = await worker.fetch(request, env, { waitUntil: promise => tasks.push(promise) });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    await Promise.allSettled(tasks);
  } catch { outgoing.writeHead(500).end("Offline harness failure"); }
});
server.listen(port, "127.0.0.1", () => console.log(`Offline-only harness: http://127.0.0.1:${port}; synthetic fixtures: ${fixture}. No Reddit network access.`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
