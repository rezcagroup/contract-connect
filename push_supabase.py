"""Upload the Westchester, NYC and public-bid data to Supabase, where signed-in users can read only the areas they picked.

Run after pull_westchester.py / pull_nyc.py:  python3 push_supabase.py
Needs two environment variables (in GitHub they are repository secrets):
  SUPABASE_URL         e.g. https://abcd1234.supabase.co
  SUPABASE_SECRET_KEY  the project's secret key (sb_secret_...) or legacy service_role key. Never put it in the page.
Without them it prints a note and exits without error, so the rest of the daily job still runs.

Tables (see supabase/schema.sql):
  projects   one row per referral / filing: region, id, area ('wc:<town>' or 'nyc:<borough>'), payload
  area_info  town contacts, keyed by area
  meta       NYC pull info, bid pull info, and the list of areas with project counts for the area picker
  projects   also holds open public bids (region 'bids', area 'bids:nyc'), from pull_bids.py
Each run stamps its rows with a run id, then deletes rows of that region left over from older runs.
"""
import json, os, sys, time, urllib.request, urllib.error, urllib.parse
from pathlib import Path

R = Path(__file__).parent
URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
RUN = time.strftime("%Y%m%d%H%M%S", time.gmtime())
BATCH = 500


def load(name, default):
    p = R / "data" / name
    return json.loads(p.read_text()) if p.exists() else default


def api(method, path, body=None, prefer=None):
    headers = {"apikey": KEY, "Content-Type": "application/json"}
    if KEY.startswith("eyJ"):  # legacy service_role key is a JWT and also goes in Authorization
        headers["Authorization"] = "Bearer " + KEY
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(4):
        req = urllib.request.Request(f"{URL}/rest/v1/{path}", data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == 3:
                sys.exit(f"Supabase {method} {path.split('?')[0]} failed: {e.code} {e.read().decode()[:400]}")
        except urllib.error.URLError as e:
            if attempt == 3:
                sys.exit(f"Supabase unreachable: {e}")
        time.sleep(2 ** attempt * 3)


def upsert(table, rows, conflict):
    for i in range(0, len(rows), BATCH):
        api("POST", f"{table}?on_conflict={conflict}", rows[i:i + BATCH], "resolution=merge-duplicates,return=minimal")


def westchester():
    rows = load("data.json", [])
    if not rows:
        print("Westchester: no rows in data/data.json, skipped")
        return [], {}
    ev, att, team, permits = load("ev.json", {}), load("att.json", {}), load("team.json", {}), load("permits.json", {})
    contacts = load("contacts.json", {})
    projects = []
    for r in rows:
        fid, town = r[0], r[3]
        payload = {"r": r}
        for k, src in (("ev", ev), ("att", att), ("team", team), ("permit", permits)):
            if fid in src:
                payload[k] = src[fid]
        projects.append({"region": "wc", "id": fid, "area": "wc:" + town, "payload": payload, "run": RUN})
    upsert("projects", projects, "region,id")
    api("DELETE", f"projects?region=eq.wc&run=neq.{RUN}")
    info = [{"area": "wc:" + t, "payload": c, "run": RUN} for t, c in contacts.items()]
    if info:
        upsert("area_info", info, "area")
        api("DELETE", f"area_info?area=like.wc:*&run=neq.{RUN}")
    counts = {}
    for r in rows:
        counts[r[3]] = counts.get(r[3], 0) + 1
    print(f"Westchester: {len(projects)} projects in {len(counts)} towns, {len(info)} town contact entries")
    return projects, counts


def nyc():
    src = load("nyc.json", {})
    rows = src.get("rows", [])
    if not rows:
        print("NYC: no rows in data/nyc.json, skipped")
        return {}
    projects = [{"region": "nyc", "id": r[0], "area": "nyc:" + r[4], "payload": r, "run": RUN} for r in rows]
    upsert("projects", projects, "region,id")
    api("DELETE", f"projects?region=eq.nyc&run=neq.{RUN}")
    upsert("meta", [{"key": "nyc", "payload": {k: v for k, v in src.items() if k != "rows"}}], "key")
    counts = {}
    for r in rows:
        counts[r[4]] = counts.get(r[4], 0) + 1
    print(f"NYC: {len(projects)} filings in {len(counts)} boroughs")
    return counts


def bids():
    """Open public bids (NYC City Record). One area, 'bids:nyc'. A pull with zero open bids still clears the old rows."""
    src = load("bids.json", None)
    if src is None:
        print("Bids: no data/bids.json, skipped")
        return 0
    rows = src.get("rows", [])
    if rows:
        upsert("projects", [{"region": "bids", "id": b["id"], "area": "bids:nyc", "payload": b, "run": RUN} for b in rows], "region,id")
    api("DELETE", f"projects?region=eq.bids&run=neq.{RUN}")
    upsert("meta", [{"key": "bids", "payload": {"pulled": src.get("pulled", ""), "source": src.get("source", "")}}], "key")
    print(f"Bids: {len(rows)} open construction solicitations")
    return len(rows)


def main():
    if not URL or not KEY:
        print("SUPABASE_URL / SUPABASE_SECRET_KEY not set: nothing uploaded")
        return
    _, wc_counts = westchester()
    nyc_counts = nyc()
    bid_count = bids()
    # The area picker's list: every area on the county map (43 areas covering all 45 municipalities), so people can
    # pick a town before its next project is filed. Towns with no current projects show 0.
    towns = sorted(set(wc_counts) | set(load("contacts.json", {})) | set(load("shapes.json", {}).get("wc", {})))
    boros = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"]
    areas = {
        "wc": [{"area": "wc:" + t, "name": t, "count": wc_counts.get(t, 0)} for t in towns],
        "nyc": [{"area": "nyc:" + b, "name": b, "count": nyc_counts.get(b, 0)} for b in boros],
    }
    if load("bids.json", None) is not None:
        areas["bids"] = [{"area": "bids:nyc", "name": "NYC City Record", "count": bid_count}]
    if wc_counts or nyc_counts:
        upsert("meta", [{"key": "areas", "payload": areas}], "key")
    print("Uploaded to", urllib.parse.urlparse(URL).netloc)


if __name__ == "__main__":
    main()
