"""Build the Contract Connect site from src/. Run: python3 build.py

Pages (written to the repo root and published by the daily GitHub job):
  index.html        public landing page
  login.html        sign up, log in, password reset
  areas.html        pick towns and boroughs
  westchester.html  Westchester app (County Planning Board referrals)
  nyc.html          NYC app (Department of Buildings filings)
  cc.js, cc.css     shared sign-in code and styles
  ccmap.js          the outline map both apps use (shapes from data/shapes.json, see pull_shapes.py)

No project data goes into these files. The app pages load it after sign-in from Supabase, which returns only the
areas the user picked (see supabase/schema.sql and push_supabase.py). Supabase settings come from site_config.json.
"""
import base64, hashlib, json, re
from pathlib import Path
R = Path(__file__).parent
SRC = R / "src"
FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800;900&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">\n')
SB = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\n<script src="cc.js"></script>\n'
ICONS = ('<link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32.png">\n'
         '<link rel="icon" type="image/png" sizes="192x192" href="assets/favicon-192.png">\n'
         '<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">\n<meta name="theme-color" content="#141a22">\n')
SITE = "https://rezcagroup.github.io/contract-connect/"
# Link previews (texts, Slack, social posts) for the landing page.
SHARE = ('<meta property="og:type" content="website">\n<meta property="og:site_name" content="Contract Connect">\n'
         '<meta property="og:title" content="Contract Connect: find the job before everyone else bids it">\n'
         '<meta property="og:description" content="Early private construction leads for Westchester and NYC, sized for your trade, with who to call.">\n'
         f'<meta property="og:url" content="{SITE}">\n<meta property="og:image" content="{SITE}assets/og-image.png">\n'
         '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'
         '<meta name="twitter:card" content="summary_large_image">\n')
CC_HEAD = ICONS + FONTS + '<link rel="stylesheet" href="cc.css">\n' + SB


VERSIONS = {}  # shared file -> short hash of its contents, so pages ask for the matching copy after an update


def write(out, text):
    if out.endswith(".html"):
        # Browsers keep cc.js, cc.css and ccmap.js for up to 10 minutes (GitHub Pages caching). A version tag that changes
        # with the file makes them fetch the new copy as soon as a page from a new build loads.
        for name, v in VERSIONS.items():
            text = re.sub(r'((?:src|href)="' + re.escape(name) + r')"', r'\1?v=' + v + '"', text)
    else:
        VERSIONS[out] = hashlib.sha1(text.encode()).hexdigest()[:10]
    (R / out).write_text(text)
    print("Built", out, len(text), "bytes")


SHAPES = json.loads((R / "data" / "shapes.json").read_text()) if (R / "data" / "shapes.json").exists() else {}


def app(out, title, body, script, region, swaps):
    """An app page: the old page's markup and styles, with its script wrapped to run once CC.boot has the user's data."""
    js = (SRC / script).read_text()
    for old, new in swaps:
        assert old in js, f"{script}: expected {old!r}"
        js = js.replace(old, new)
    body_html = (SRC / body).read_text()
    if "__PULLED__" in body_html:
        body_html = body_html.replace("__PULLED__", re.search(r'const PULLED = "([^"]*)";', js).group(1))
    head = (SRC / "head.html").read_text().replace("Westchester Construction Lead Machine", title)
    head = head.replace("family=Barlow+Condensed:wght@600;700;800&", "family=Barlow+Condensed:wght@600;700;800;900&")
    head += ICONS + '<link rel="stylesheet" href="cc.css">\n' + SB + '<script src="ccmap.js"></script>\n'
    # Town / borough outlines for the map (public boundary data, not project data).
    head += '<script>window.CC_SHAPES=' + json.dumps(SHAPES.get(region, {}), separators=(',', ':')) + ';</script>\n'
    write(out, head + (SRC / "css.txt").read_text() + "\n</head>\n" + body_html
          + f"<script>\nCC.boot('{region}', function(D){{\n" + js + "\n});\n</script>\n</body>\n</html>\n")


cfg = json.loads((R / "site_config.json").read_text())
url, key = cfg.get("supabase_url", "").strip(), cfg.get("supabase_publishable_key", "").strip()
def is_secret(k):
    if k.startswith("sb_secret_"):
        return True
    if k.startswith("eyJ") and k.count(".") == 2:  # legacy key: a JWT whose payload names its role
        try:
            part = k.split(".")[1]
            return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))).get("role") == "service_role"
        except ValueError:
            return False
    return False


if is_secret(key):
    raise SystemExit("site_config.json holds a SECRET key. Use the publishable (anon) key; the secret key belongs only in GitHub secrets.")
if not (url and key):
    print("Note: site_config.json has no Supabase URL/key yet; sign-in pages will say accounts aren't switched on.")
write("cc.js", (SRC / "cc.js").read_text().replace("__SB_URL__", url).replace("__SB_KEY__", key))
write("cc.css", (SRC / "cc.css").read_text())
write("ccmap.js", (SRC / "ccmap.js").read_text())
landing = (SRC / "landing.html").read_text()
# The landing page lists the Westchester municipalities that have projects right now (public names only, no project data).
landing = landing.replace("__WC_TOWNS__", json.dumps(sorted({r[3] for r in json.loads((R / "data" / "data.json").read_text())})))
landing = landing.replace('<link rel="stylesheet" href="cc.css">', ICONS + SHARE + '<link rel="stylesheet" href="cc.css">', 1)
write("index.html", landing.replace("family=Barlow+Condensed:wght@600;700;800&", "family=Barlow+Condensed:wght@600;700;800;900&"))
for page in ("login.html", "areas.html"):
    write(page, (SRC / page).read_text().replace("<!--CC_HEAD-->", CC_HEAD))
app("westchester.html", "Westchester · Contract Connect", "body.html", "script.js", "wc", [
    ("const RAW = __DATA__;", "const RAW = D.RAW;"), ("const CONTACTS = __CONTACTS__;", "const CONTACTS = D.CONTACTS;"),
    ("const ATT = __ATT__;", "const ATT = D.ATT;"), ("const TEAM = __TEAM__;", "const TEAM = D.TEAM;"),
    ("const EV = __EV__;", "const EV = D.EV;"), ("const PERMITS = __PERMITS__;", "const PERMITS = D.PERMITS;")])
app("nyc.html", "New York City · Contract Connect", "nyc_body.html", "nyc_script.js", "nyc", [
    ("const SRC = __NYC__;", "const SRC = D.NYC;"),
    # The borough buttons show only the boroughs this user picked.
    ("const BOROS = ['Manhattan','Brooklyn','Queens','Bronx','Staten Island'];",
     "const BOROS = ['Manhattan','Brooklyn','Queens','Bronx','Staten Island'].filter(b=>D.areas.includes(b));")])
