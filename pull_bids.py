"""Pull open NYC construction solicitations from the City Record into data/bids.json.

Run: python3 pull_bids.py, then python3 build.py

Source (Socrata API, no key needed; set NYC_APP_TOKEN to avoid rate limits):
  dg92-zbpx  City Record Online: every notice the city publishes. We keep Procurement notices of type Solicitation in the two
             construction categories whose due date has not passed (bids still open).

One row per solicitation (a "Correction:" notice replaces the earlier notice with the same PIN). Rows are objects, not arrays:
  id, filed, due, agency, kind, title, method, pin, contact {name, phone, email}, address, desc, extra, link
"""
import datetime, html, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

R = Path(__file__).parent
HOST = "https://data.cityofnewyork.us/resource/dg92-zbpx.json"
TZ = ZoneInfo("America/New_York")
CATEGORIES = {"Construction/Construction Services": "Construction", "Construction Related Services": "Related services"}
DESC_CHARS = 1500
STALE_TBD_DAYS = 180  # a notice whose due date is "to be announced" is dropped once it is this old
# The city leaves "." or zeros in contact fields it does not fill in.
EMPTY = {"", ".", "-", "n/a", "na", "none", "(000) 000-0000"}


def fetch(req, tries=6):
    """Open a request, retrying with backoff (10s, 20s, 40s...) on 429/5xx errors and network failures."""
    for attempt in range(1, tries + 1):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ConnectionError) as e:
            code = getattr(e, "code", None)
            if not (code is None or code == 429 or code >= 500) or attempt == tries:
                raise
            wait = 10 * 2 ** (attempt - 1)
            print(f"City Record request failed ({e}); retry {attempt}/{tries - 1} in {wait}s", file=sys.stderr)
            time.sleep(wait)


def get(**params):
    """Fetch every row for a query, paging 5,000 at a time (the notices carry long text)."""
    out, offset = [], 0
    while True:
        q = dict(params, **{"$limit": 5000, "$offset": offset, "$order": ":id"})
        req = urllib.request.Request(HOST + "?" + urllib.parse.urlencode(q))
        if os.environ.get("NYC_APP_TOKEN"):
            req.add_header("X-App-Token", os.environ["NYC_APP_TOKEN"])
        page = fetch(req)
        out += page
        if len(page) < 5000:
            return out
        offset += 5000


class Text(HTMLParser):
    """HTML notice body to plain text, with paragraph breaks kept."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in ("br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4"):
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def plain(v, limit=None):
    p = Text()
    p.feed(str(v or ""))
    s = html.unescape("".join(p.parts)).replace("\x1a", "'").replace("\xa0", " ")
    s = "".join(c for c in s if c == "\n" or c >= " ")
    s = "\n".join(" ".join(line.split()) for line in s.split("\n"))
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    if limit and len(s) > limit:
        s = s[:limit].rsplit(" ", 1)[0] + "…"
    return s


def clean(v):
    v = " ".join(str(v or "").split())
    return "" if v.lower() in EMPTY else v


def email(v):
    v = clean(v).lower()
    return v if "@" in v and "." in v.split("@")[-1] and " " not in v else ""


def phone(v):
    d = "".join(c for c in str(v or "") if c.isdigit())[-10:]
    return f"({d[:3]}) {d[3:6]}-{d[6:]}" if len(d) == 10 and d[0] not in "01" and len(set(d)) > 2 else ""


def main():
    today = datetime.datetime.now(TZ).date()
    cats = ",".join("'" + c + "'" for c in CATEGORIES)
    rows = get(**{"$where": "section_name = 'Procurement' AND type_of_notice_description = 'Solicitation' "
                            f"AND category_description in ({cats}) AND due_date >= '{today.isoformat()}T00:00:00'"})
    best = {}  # one row per PIN: the latest notice (a correction replaces the original)
    for r in rows:
        if not r.get("request_id") or not r.get("due_date"):
            continue
        # Postponed bids carry a placeholder far-future year (9999, 2999, 2099). Keep them only while recent, and show the due date as to be announced.
        if int(r["due_date"][:4]) > today.year + 2:
            if (r.get("start_date") or "")[:10] < (today - datetime.timedelta(days=STALE_TBD_DAYS)).isoformat():
                continue
            r["due_date"] = ""
        k = clean(r.get("pin")) or r["request_id"]
        if k not in best or (r.get("start_date", ""), r["request_id"]) > (best[k].get("start_date", ""), best[k]["request_id"]):
            best[k] = r
    out = []
    for r in best.values():
        c = {"name": clean(r.get("contact_name")), "phone": phone(r.get("contact_phone")), "email": email(r.get("email"))}
        extra = "\n\n".join(t for t in (plain(r.get(k), 600) for k in ("other_info_1", "other_info_2", "other_info_3")) if t)
        out.append({
            "id": r["request_id"], "filed": (r.get("start_date") or "")[:10], "due": (r.get("due_date") or "")[:16],  # "" = due date to be announced
            "agency": clean(r.get("agency_name")).title(), "kind": CATEGORIES.get(r.get("category_description"), ""),
            "title": clean(plain(r.get("short_title"))), "method": clean(r.get("selection_method_description")),
            "pin": clean(r.get("pin")), "contact": c if any(c.values()) else None,
            "address": clean(r.get("address_to_request")), "desc": plain(r.get("additional_description_1"), DESC_CHARS),
            "extra": extra, "link": "https://a856-cityrecord.nyc.gov/RequestDetail/" + r["request_id"],
        })
    out.sort(key=lambda b: (b["due"] == "", b["due"], b["id"]))  # soonest due first, to-be-announced last
    (R / "data/bids.json").write_text(json.dumps({"pulled": today.isoformat(), "source": "NYC City Record", "rows": out},
                                                 separators=(",", ":"), ensure_ascii=False))
    print(f"Wrote data/bids.json: {len(out)} open construction solicitations (from {len(rows)} notices), "
          f"{sum(1 for b in out if b['contact'])} with a contact, {sum(1 for b in out if not b['due'])} with the due date to be announced")


if __name__ == "__main__":
    main()
