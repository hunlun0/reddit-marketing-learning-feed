"""Optional real-Chromium smoke against the loopback Node harness, NOT workerd.
Requires Python + playwright and Chromium. No Reddit requests or real credentials.
Run: python scripts/browser-smoke.py (CHROMIUM_PATH may override browser path).
"""
import json, os, pathlib, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "evidence"
EVIDENCE.mkdir(exist_ok=True)
KEY = "test-only-not-a-real-secret-" + "x" * 40
checks = []
def check(name, assertion):
    if not assertion:
        raise AssertionError(name)
    checks.append({"name": name, "status": "PASS"})
def start(port, fixture=False):
    env = {**os.environ, "PORT": str(port)}
    env.pop("REFRESH_KEY", None)
    out = open(EVIDENCE / ("browser-fixture-server.txt" if fixture else "browser-empty-server.txt"), "w")
    proc = subprocess.Popen(["node", "scripts/offline-server.mjs", *( ["--fixture"] if fixture else [] )], cwd=ROOT, env=env, stdout=out, stderr=out)
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1)
            return proc, out
        except Exception:
            time.sleep(.1)
    raise RuntimeError("Offline harness did not start")
servers = []
try:
    servers = [start(8791), start(8792, True)]
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"), headless=True, args=["--no-sandbox"])
        context = browser.new_context(viewport={"width":390,"height":844}, device_scale_factor=1, is_mobile=True, has_touch=True)
        page = context.new_page()
        errors, outbound = [], []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("request", lambda r: outbound.append(r.url) if not r.url.startswith("http://127.0.0.1:") else None)
        response = page.goto("http://127.0.0.1:8791/", wait_until="networkidle")
        page.wait_for_function("document.getElementById('service-status').textContent.includes('not configured')")
        check("no-credentials shell loads HTTP 200", response.status == 200)
        check("explicit API-not-configured state", "Reddit API not configured." in page.locator("#service-status").inner_text())
        check("no secret configuration is rendered", "fixture-secret" not in page.content())
        check("empty mobile layout has no horizontal overflow", page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        page.screenshot(path=str(EVIDENCE / "mobile-unconfigured.png"), full_page=True)
        page.goto("http://127.0.0.1:8792/", wait_until="networkidle")
        check("private login shown", page.locator("#unlock-panel").is_visible())
        check("feed hidden before login", not page.locator("#feed-panel").is_visible())
        page.locator("#key").fill(KEY)
        page.locator("#unlock").click()
        page.wait_for_selector("#feed-panel", state="visible")
        check("signed-cookie login succeeds in a real browser", page.locator(".post").count() == 40)
        check("password field cleared immediately", page.locator("#key").input_value() == "")
        cookie = next(c for c in context.cookies() if c["name"] == "__Host-rmlf")
        check("cookie is HttpOnly Secure SameSite Strict", cookie["httpOnly"] and cookie["secure"] and cookie["sameSite"] == "Strict")
        check("cookie contains no raw REFRESH_KEY", KEY not in cookie["value"])
        check("hostile HTML is displayed as text", '<img src=x onerror=' in page.locator(".post h3").first.inner_text())
        check("XSS payload did not execute", page.evaluate("window.XSS_EXECUTED !== true"))
        check("no attacker img or script nodes inserted", page.locator("#posts img, #posts script").count() == 0)
        check("all generated post links use Reddit HTTPS", page.locator("#posts a").evaluate_all("as => as.every(a => a.href.startsWith('https://www.reddit.com/r/PPC/comments/'))"))
        check("browser storage contains no content or secret", page.evaluate("localStorage.length === 0 && sessionStorage.length === 0"))
        page.screenshot(path=str(EVIDENCE / "mobile-private-feed.png"), full_page=False)
        check("populated 390px mobile layout has no horizontal overflow", page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        page.set_viewport_size({"width":320,"height":740})
        check("narrow 320px mobile layout has no horizontal overflow", page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        page.set_viewport_size({"width":390,"height":844})
        page.locator("#more").click()
        check("progressive rendering shows remaining posts", page.locator(".post").count() == 45)
        page.locator("#sort").select_option("score")
        check("score sorting works in DOM", "workflow 45" in page.locator(".post h3").first.inner_text())
        page.locator("#sort").select_option("comments")
        check("comment sorting works in DOM", "onerror=" in page.locator(".post h3").first.inner_text())
        page.locator("#search").fill("synthetic XSS safety")
        check("excerpt search filters results", page.locator(".post").count() == 1)
        page.locator("#clear-filters").click()
        page.locator("#days").select_option("1")
        count = page.locator(".post").count()
        check("last 24h filter works", 22 <= count <= 24)
        page.locator("#more-filters summary").click()
        page.locator("#category").select_option("Google Ads")
        page.locator("#keyword").select_option("ppc")
        page.locator("#subreddit").select_option("PPC")
        check("category keyword subreddit filters combine", page.locator(".post").count() == count)
        check("refresh disabled when Reddit API missing", page.locator("#refresh").is_disabled())
        # Simulate a later API failure; previously displayed posts must not be cleared.
        page.route("**/api/refresh", lambda route: route.fulfill(status=503, content_type="application/json", body=json.dumps({"error":"upstream_error","message":"Temporary upstream failure"})))
        page.evaluate("document.getElementById('refresh').disabled = false")
        page.locator("#refresh").click()
        page.wait_for_function("document.getElementById('message').textContent.includes('Temporary upstream failure')")
        check("refresh failure preserves loaded reading list", page.locator(".post").count() == count)
        page.locator("#logout").click()
        page.wait_for_selector("#unlock-panel", state="visible")
        check("logout removes displayed posts", page.locator(".post").count() == 0)
        check("logout clears session cookie", not any(c["name"] == "__Host-rmlf" for c in context.cookies()))
        check("no JavaScript runtime exceptions", len(errors) == 0)
        check("no external network requests", len(outbound) == 0)
        report = {"runtime": "Chromium via Python Playwright, against Node loopback harness (not workerd)", "browser_version": browser.version, "checks": checks, "passed": len(checks), "failed": 0, "page_errors": errors, "external_requests": outbound}
        (EVIDENCE / "browser-smoke.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
        context.close(); browser.close()
finally:
    for proc, out in servers:
        proc.terminate()
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired: proc.kill()
        out.close()
