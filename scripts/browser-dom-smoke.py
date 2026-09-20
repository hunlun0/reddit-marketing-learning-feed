"""DOM-only Chromium acceptance with actual application JS and a local HTTP bridge.
No browser navigation is performed (restricted by this environment's browser policy).
This is NOT native-browser-cookie, HTTP CSP, workerd or deployed-cloud acceptance.
Optional Python Playwright + system Chromium; no production runtime dependency.
"""
import json, os, pathlib, re, subprocess, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'evidence'
EVIDENCE.mkdir(exist_ok=True)
KEY = 'test-only-not-a-real-secret-' + 'x' * 40
checks, processes, handles = [], [], []
def check(name, condition):
    if not condition: raise AssertionError(name)
    checks.append({'name': name, 'status':'PASS'})
def start(port, fixture):
    log = open(EVIDENCE / f'dom-harness-{port}.txt', 'w'); handles.append(log)
    env = dict(os.environ, PORT=str(port)); env.pop('REFRESH_KEY', None)
    proc = subprocess.Popen(['node', 'scripts/offline-server.mjs'] + (['--fixture'] if fixture else []), cwd=ROOT, env=env, stdout=log, stderr=log)
    processes.append(proc)
    for _ in range(40):
        try: urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=1); return
        except Exception: time.sleep(.1)
    raise RuntimeError('Node harness failed to start')
try:
    start(8793, False); start(8794, True)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width':390,'height':844})
        errors, network = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda req: network.append(req.url))
        bridge = {'port':8793, 'cookie': '', 'fail_refresh':False, 'cookie_header':''}
        def bridge_fetch(path, options):
            if path not in ['/api/status','/api/feed','/api/session','/api/logout','/api/refresh']: raise ValueError('Unexpected route')
            if path == '/api/refresh' and bridge['fail_refresh']:
                return {'status':503,'body':json.dumps({'error':'upstream_error','message':'Temporary upstream failure'}),'headers':{'content-type':'application/json'}}
            base = f'http://127.0.0.1:{bridge["port"]}'
            headers = options.get('headers', {}).copy()
            if bridge['cookie']: headers['Cookie'] = bridge['cookie']
            method = options.get('method','GET')
            if method == 'POST': headers['Origin'] = base
            request = urllib.request.Request(base+path, method=method, headers=headers)
            try: result = urllib.request.urlopen(request, timeout=5)
            except urllib.error.HTTPError as error: result = error
            cookie = result.headers.get('set-cookie')
            if cookie:
                bridge['cookie_header'] = cookie
                bridge['cookie'] = '' if 'Max-Age=0' in cookie else cookie.split(';')[0]
            return {'status':result.status, 'body':result.read().decode(), 'headers':dict(result.headers)}
        page.expose_function('bridgeFetch', bridge_fetch)
        html = (ROOT/'public/index.html').read_text()
        html = re.sub(r'<script[^>]+src="/app.js"[^>]*></script>', '', html)
        html = re.sub(r'<link[^>]+href="/styles.css"[^>]*>', '', html)
        view = (ROOT/'public/view.js').read_text().replace('export function ', 'function ')
        app = re.sub(r'^import .*?;\n', '', (ROOT/'public/app.js').read_text(), count=1)
        fetch_script = """window.fetch = async (path, options = {}) => {
          const safe = {method: options.method || 'GET', headers: options.headers || {}};
          const value = await window.bridgeFetch(path, safe);
          return new Response(value.body, {status:value.status,headers:value.headers});
        };"""
        def mount(fixture=False):
            page.set_content(html.replace('<main>', '<main><p class="notice">DOM TEST · SYNTHETIC DATA ONLY</p>' if fixture else '<main>'))
            page.add_style_tag(content=(ROOT/'public/styles.css').read_text())
            page.evaluate('() => {' + fetch_script + '}')
            page.evaluate('(async () => {\n'+view+'\n'+app+'\n})()')
        mount()
        check('API-not-configured message renders without credentials', 'Reddit API not configured.' in page.locator('#service-status').inner_text())
        check('no horizontal overflow at 390px, unconfigured', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.screenshot(path=str(EVIDENCE/'mobile-unconfigured.png'), full_page=True)
        bridge['port'] = 8794
        mount(True)
        check('private login visible before access', page.locator('#unlock-panel').is_visible())
        check('feed not visible before access', not page.locator('#feed-panel').is_visible())
        page.locator('#key').fill(KEY); page.locator('#unlock').click(); page.wait_for_selector('#feed-panel',state='visible')
        check('UI login works with actual Worker auth through Node bridge', page.locator('.post').count() == 40)
        check('password input is immediately cleared', page.locator('#key').input_value() == '')
        check('server returns signed Secure HttpOnly Strict cookie', all(s in bridge['cookie_header'] for s in ['HttpOnly','Secure','SameSite=Strict']))
        check('server cookie does not contain the key', KEY not in bridge['cookie_header'])
        check('hostile HTML title remains literal text', '<img src=x onerror=' in page.locator('.post h3').first.inner_text())
        check('hostile excerpt did not execute JavaScript', page.evaluate('window.XSS_EXECUTED !== true'))
        check('no injected image or script DOM nodes', page.locator('#posts img, #posts script').count() == 0)
        check('all clickable post links are canonical Reddit HTTPS', page.locator('#posts a').evaluate_all("as => as.every(a => a.href.startsWith('https://www.reddit.com/r/PPC/comments/'))"))
        check('mobile populated layout fits at 390px', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.screenshot(path=str(EVIDENCE/'mobile-private-feed.png'),full_page=False)
        page.set_viewport_size({'width':320,'height':740})
        check('narrow mobile populated layout fits at 320px', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.set_viewport_size({'width':1200,'height':900})
        check('desktop layout fits at 1200px', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.screenshot(path=str(EVIDENCE/'desktop-private-feed.png'),full_page=False)
        page.set_viewport_size({'width':390,'height':844})
        page.locator('#more').click()
        check('show-more renders remaining posts',page.locator('.post').count()==45)
        page.locator('#sort').select_option('score')
        check('highest-score sorting affects rendered order','workflow 45' in page.locator('.post h3').first.inner_text())
        page.locator('#sort').select_option('comments')
        check('most-comments sorting affects rendered order','onerror=' in page.locator('.post h3').first.inner_text())
        page.locator('#search').fill('synthetic XSS safety')
        check('excerpt search works',page.locator('.post').count()==1)
        page.locator('#clear-filters').click(); page.locator('#days').select_option('1')
        count=page.locator('.post').count()
        check('last-24h filtering works',22<=count<=24)
        page.locator('#more-filters summary').click()
        page.locator('#category').select_option('Google Ads'); page.locator('#keyword').select_option('ppc'); page.locator('#subreddit').select_option('PPC')
        check('category, keyword and subreddit combine',page.locator('.post').count()==count)
        check('manual refresh disabled without Reddit API',page.locator('#refresh').is_disabled())
        bridge['fail_refresh']=True; page.evaluate("document.getElementById('refresh').disabled=false"); page.locator('#refresh').click()
        page.wait_for_function("document.getElementById('message').textContent.includes('Temporary upstream failure')")
        check('failed refresh preserves existing displayed posts',page.locator('.post').count()==count)
        page.locator('#logout').click(); page.wait_for_selector('#unlock-panel',state='visible')
        check('logout clears rendered posts',page.locator('.post').count()==0)
        check('logout tells bridge to remove session cookie',bridge['cookie']=='')
        check('no JavaScript runtime errors',errors==[])
        check('no browser network requests',network==[])
        report={'runtime':'Chromium DOM, actual app JavaScript + Node HTTP bridge; no native HTTP navigation/cookie/CSP enforcement or workerd verification', 'browser_version':browser.version, 'passed':len(checks),'failed':0,'checks':checks,'page_errors':errors,'browser_network_requests':network}
        (EVIDENCE/'browser-dom-smoke.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2)); browser.close()
finally:
    for proc in processes:
        proc.terminate()
        try: proc.wait(timeout=3)
        except subprocess.TimeoutExpired: proc.kill()
    for handle in handles: handle.close()
