"""Weitere Portale für „Ganz Thailand“: PropertyHub (Condo, Haus, Reihenhaus) und Renthub (Apartments).

Höflich wie bei DotProperty: immer nur EINE Anfrage gleichzeitig, Pause zwischen den Seiten, bei 403/429
sofort aufhören (Job rot -> nichts wird veröffentlicht, alter Stand bleibt).

    python3 scraper/th_extra.py crawl --source ph --state ph-state.json.gz --out ph.json.gz
    python3 scraper/th_extra.py crawl --source rh --state rh-state.json.gz --out rh.json.gz

Ergebnis (out): {"source", "items": [...Vertragsformat wie th_crawl...], "counts", "geo", "failed"} –
zugleich der Zustand für den nächsten Lauf (Lagen von Projekten/Häusern ändern sich nicht -> gemerkt).
Lage:
  * PropertyHub-Häuser/Reihenhäuser: Koordinaten stehen in der Liste.
  * PropertyHub-Condos: Lage + Fertigstellungsjahr des PROJEKTS (eine Projektseite je Projekt, gemerkt).
  * Renthub: Lage + Zimmergrößen aus der Detailseite (je Haus einmal, gemerkt).
Was in einem Lauf noch keine Lage hat, kommt erst, wenn sie bekannt ist (Zeitbudget je Lauf).
"""
import argparse, gzip, json, os, re, sys, time, urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scrape  # noqa: E402
from th_crawl import PROVINCES  # noqa: E402

DELAY = float(os.environ.get("TH_EXTRA_DELAY", "2.0"))
HERE = os.path.dirname(os.path.abspath(__file__))
SLUGS = json.load(open(os.path.join(HERE, "th_extra_slugs.json"), encoding="utf-8"))
PH = "https://propertyhub.in.th/en/"
RH = "https://www.renthub.in.th/en/"
PH_IMG = "https://bcdn.propertyhub.in.th"
RH_IMG = "https://bcdn.renthub.in.th"
YEAR = datetime.now(timezone.utc).year


METRO = ("bangkok", "nonthaburi", "samut-prakan", "pathum-thani")
ORDER = sorted(PROVINCES, key=lambda p: p in METRO)      # Großraum Bangkok zuletzt (riesig, für uns zweitrangig)


class Blocked(Exception):
    pass


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def load_gz(path, default):
    try:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_gz(path, obj):
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def next_data(page):
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', page, re.S)
    return json.loads(m.group(1)) if m else None


ERRS = {"row": 0}


def get(url):
    """Seite laden; 403/429 = Sperre -> Abbruch des ganzen Laufs. 404/Fehler -> None (10 Fehler am Stück -> Abbruch)."""
    try:
        page = scrape.fetch(url)
        ERRS["row"] = 0
    except Exception as e:  # noqa: BLE001
        s = str(e)
        if "403" in s or "429" in s:
            raise Blocked(s[:80])
        if "404" not in s:
            ERRS["row"] += 1
            log("Fehler", url[:90], s[:100])
            if ERRS["row"] >= 10:
                raise Blocked("10 Fehler hintereinander")
        return None
    finally:
        time.sleep(DELAY)
    try:
        return next_data(page)
    except ValueError:
        return None


def numf(x):
    try:
        v = float(str(x).replace(",", "."))
        return (int(v) if v == int(v) else v) if v > 0 else None
    except (TypeError, ValueError):
        return None


def money(x):
    try:
        v = int(float(x))
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------------ PropertyHub
PH_TYPES = [("condo", "condo-for-rent"), ("home", "home-for-rent"), ("townhome", "townhome-for-rent")]
# PropertyHub schreibt Provinzen anders als DotProperty
PH_PROV_ALIAS = {"samut prakarn": "samut-prakan", "phra nakhon sri ayutthaya": "phra-nakhon-si-ayutthaya", "ayutthaya": "phra-nakhon-si-ayutthaya",
                 "nakhon sri thammarat": "nakhon-si-thammarat", "buri ram": "buriram", "si sa ket": "sisaket", "samut songkram": "samut-songkhram",
                 "petchaburi": "phetchaburi", "phetburi": "phetchaburi", "chaingmai": "chiang-mai", "chon buri": "chonburi", "lop buri": "lopburi",
                 "prachin buri": "prachinburi", "suphanburi": "suphan-buri", "singburi": "sing-buri", "nong bua lamphu": "nong-bua-lam-phu",
                 "korat": "nakhon-ratchasima", "prachuap khirikhan": "prachuap-khiri-khan", "sa kaew": "sa-kaeo", "sakaeo": "sa-kaeo"}
PROV_NAMES = sorted([(p.replace("-", " "), p) for p in PROVINCES] + list(PH_PROV_ALIAS.items()), key=lambda x: -len(x[0]))


def prov_of(address):
    """'Bang Lamung Chonburi' -> 'chonburi' (Leerzeichen egal: 'Pathumthani' = 'pathum thani')."""
    a = re.sub(r"[^a-z]", "", (address or "").lower())
    for name, slug in PROV_NAMES:
        if a.endswith(name.replace(" ", "")):
            return slug
    return None


def ph_items(pp, kind):
    arr, pag = pp.get("resultListings") or [], pp.get("pagination") or {}
    out = []
    for x in arr:
        # FOR_RENT_TRIAL = Miet-Inserat eines Probe-Kontos (ebenfalls echte Miete); alles andere (Verkauf) überspringen
        if not str(x.get("postType") or "FOR_RENT").startswith("FOR_RENT"):
            continue
        pr = money((((x.get("price") or {}).get("forRent") or {}).get("monthly") or {}).get("price"))
        ri = x.get("roomInformation") or {}
        lh = x.get("landAndHouseInformation") or {}
        loc = x.get("location") or {}
        proj = x.get("project") or {}
        addr = x.get("address") or proj.get("address")
        prov = prov_of(addr)
        r = {"id": "ph-" + str(x["id"]), "url": f"{PH}listings/{x.get('slug')}---{x['id']}", "title": x.get("title"),
             "price": pr, "prov": prov, "beds": numf(ri.get("numberOfBed") or lh.get("numberOfBed")),
             "size": numf(ri.get("roomArea") or lh.get("usableArea")), "src": "PropertyHub", "area": addr,
             "img": PH_IMG + x["coverPicture"] + "?width=640" if x.get("coverPicture") else None,
             "posted": (x.get("createdAt") or "")[:10] or None, "upd": (x.get("refreshedAt") or x.get("updatedAt") or "")[:10] or None,
             "kind": {"condo": "Condo", "home": "Haus", "townhome": "Reihenhaus"}[kind], "ck": f"all|{kind}"}
        if loc.get("lat") and loc.get("lng"):
            r["lat"], r["lng"] = loc["lat"], loc["lng"]
        if proj.get("id"):
            r["proj"] = str(proj["id"])
            r["projslug"] = proj.get("slug")
        out.append({k: v for k, v in r.items() if v not in (None, "")})
    return out, pag


def crawl_ph(state, out, budget_end):
    """Ganz Thailand je Objektart (die Liste ohne Ortsfilter enthält schon die Koordinaten). Seiten: /<art>/<n>."""
    for kind, path in PH_TYPES:
        key = f"all|{kind}"
        p, got, total, ok, pages, empty = 1, {}, None, True, None, 0
        while True:
            if time.time() > budget_end:
                ok = False
                break
            d = get(f"{PH}{path}" + (f"/{p}" if p > 1 else ""))
            if not d:
                ok = pages is not None and p > pages
                break
            pp = d["props"]["pageProps"]
            items, pag = ph_items(pp, kind)
            if pag.get("page") not in (None, p):        # Seitenzahl wird nicht mehr beachtet -> lieber aufhören
                log(f"PH {key}: Seite {p} liefert Seite {pag.get('page')} – Ende")
                ok = pages is not None and p > pages
                break
            total = pag.get("totalCount", total)
            pages = pag.get("totalPages", pages)
            for it in items:
                got[it["id"]] = it
            if not items:
                empty += 1
                if empty >= 2 or (pages and p >= pages):
                    break
            if pages and p >= pages:
                break
            if p % 250 == 0:
                log(f"  PH {kind}: Seite {p} von {pages}, {len(got)} Inserate")
            p += 1
        if ok:
            out["counts"][key] = total or 0
            out["done"].append(key)
        else:
            out["failed"].append(key)
        for it in got.values():                     # auch ein Teilstand ist wertvoll (alte bleiben zusätzlich, s. u.)
            out["items"][it["id"]] = it
        log(f"PH {key}: {len(got)} von {total} {'' if ok else '(unvollständig)'}")


def ph_geo(state, out, budget_end):
    """Fertigstellungsjahr (+ Lage) je Condo-Projekt – einmal je Projekt, gemerkt."""
    geo = out["geo"]
    need = {}
    for it in out["items"].values():
        if it.get("proj") and ("p" + it["proj"]) not in geo:          # Fertigstellungsjahr des Projekts
            need.setdefault(it["proj"], [it.get("projslug"), it.get("prov"), 0])[2] += 1
    # zuerst Provinzen außerhalb Bangkoks (Küsten, Norden), dann nach Zahl der Inserate
    order = sorted(need.items(), key=lambda kv: (kv[1][1] in METRO, -kv[1][2]))
    done = 0
    for pid, (pslug, prov, n) in order:
        if time.time() > budget_end or not pslug:
            continue
        d = get(f"{PH}condo-for-rent/project-{urllib.parse.quote(pslug)}")
        pj = ((d or {}).get("props") or {}).get("pageProps", {}).get("project") or {}
        loc = pj.get("location") or {}
        cy = str((pj.get("projectInfo") or {}).get("completedYear") or pj.get("completedYear") or "")[:4]
        geo["p" + pid] = [loc.get("lat"), loc.get("lng"), int(cy) if cy.isdigit() and 1950 < int(cy) < 2100 else None]
        done += 1
        if done % 200 == 0:
            log(f"  Projektlagen: {done} von {len(need)}")
    log(f"Projekte (Baujahr) neu: {done}, offen: {len(need) - done}")


def ph_apply(out):
    for it in out["items"].values():
        g = out["geo"].get("p" + it.get("proj", ""))
        if g:
            if it.get("lat") is None and g[0]:
                it["lat"], it["lng"] = g[0], g[1]
            if g[2]:
                it["built"] = f"{g[2]}-01"
                it["built_src"] = "Projekt"


# ------------------------------------------------------------------ Renthub
def rh_items(pp, prov):
    out = []
    for x in pp.get("listings") or []:
        if x.get("apartmentIsHotel"):          # Renthub kennzeichnet Hotels selbst
            continue
        pm = ((x.get("price") or {}).get("monthly") or {})
        pr = money(pm.get("minPrice"))
        am = x.get("amenities") or {}
        r = {"id": "rh-" + str(x["id"]), "url": f"{RH}{urllib.parse.quote(x.get('slug') or '')}", "title": x.get("name") or x.get("title"),
             "price": pr, "price_max": money(pm.get("maxPrice")), "prov": prov, "src": "Renthub", "kind": "Apartment", "ck": f"{prov}|apartment",
             "img": RH_IMG + x["coverPicture"] + "?width=640" if x.get("coverPicture") else None,
             "area": ", ".join(dict.fromkeys(v for v in (x.get("subdistrict"), x.get("district")) if v)),
             "pool": "gemeinschaft" if am.get("hasPool") else None, "furn": 1 if am.get("hasFurniture") else None,
             "posted": (x.get("createdAt") or "")[:10] or None, "upd": (x.get("refreshedAt") or x.get("updatedAt") or "")[:10] or None}
        out.append({k: v for k, v in r.items() if v not in (None, "")})
    return out, pp.get("pagination") or {}


def crawl_rh(state, out, budget_end):
    for prov in ORDER:
        slug = SLUGS["rh"].get(prov)
        if not slug:
            continue
        key = f"{prov}|apartment"
        p, got, total, ok = 1, [], None, True
        while True:
            if time.time() > budget_end:
                ok = False
                break
            d = get(f"{RH}apartment/{slug}" + (f"?page={p}" if p > 1 else ""))
            if not d:
                ok = p > 1
                break
            items, pag = rh_items(d["props"]["pageProps"], prov)
            total = pag.get("totalCount", total)
            got += items
            if not items or p >= (pag.get("totalPages") or 0):
                break
            p += 1
        if ok:
            out["counts"][key] = total or 0
            for it in got:
                out["items"][it["id"]] = it
            out["done"].append(key)
        else:
            out["failed"].append(key)
        log(f"RH {key}: {len(got)} von {total} {'' if ok else '(unvollständig)'}")


def rh_geo(state, out, budget_end):
    geo = out["geo"]
    need = [it for it in out["items"].values() if it["id"] not in geo]
    need.sort(key=lambda it: it.get("prov") in METRO)
    done = 0
    for it in need:
        if time.time() > budget_end:
            break
        d = get(it["url"])
        L = (((d or {}).get("props") or {}).get("pageProps") or {}).get("listing") or {}
        loc = L.get("location") or {}
        sizes = [r.get("maxSize") or r.get("minSize") or 0 for r in L.get("rooms") or []]
        geo[it["id"]] = [loc.get("lat"), loc.get("lng"), max(sizes) if sizes and max(sizes) > 0 else None]
        done += 1
        if done % 200 == 0:
            log(f"  Renthub-Lagen: {done} von {len(need)}")
    log(f"Renthub-Lagen neu: {done}, offen: {len(need) - done}")


def rh_apply(out):
    for it in out["items"].values():
        g = out["geo"].get(it["id"])
        if g:
            if g[0]:
                it["lat"], it["lng"] = g[0], g[1]
            if g[2]:
                it["size"] = g[2]


# ------------------------------------------------------------------ main
def cmd_crawl(a):
    state = load_gz(a.state, {})
    out = {"source": a.source, "items": {}, "counts": {}, "geo": state.get("geo", {}), "done": [], "failed": []}
    t0 = time.time()
    list_end = t0 + float(os.environ.get("TH_EXTRA_LIST_SECONDS", "10800"))
    geo_end = t0 + float(os.environ.get("TH_EXTRA_MAX_SECONDS", "19000"))
    blocked = False
    try:
        (crawl_ph if a.source == "ph" else crawl_rh)(state, out, list_end)
        (ph_geo if a.source == "ph" else rh_geo)(state, out, geo_end)
    except Blocked as e:
        blocked = True
        log("Zugriff verweigert (", e, ") – Abruf wird beendet, alter Stand bleibt")
    # Provinzen/Arten mit Fehler: alte Inserate behalten
    old = state.get("items", {})
    failed = set(out["failed"])
    kept = 0
    for k, it in old.items():
        if k not in out["items"] and (it.get("ck") in failed or blocked):
            out["items"][k] = it
            kept += 1
    (ph_apply if a.source == "ph" else rh_apply)(out)
    first = state.get("first", {})
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for k, it in out["items"].items():
        first.setdefault(k, today)
        it["first"] = first[k]
    out["first"] = {k: v for k, v in first.items() if k in out["items"]}
    with_geo = sum(1 for it in out["items"].values() if it.get("lat") is not None)
    log(f"{a.source} fertig: {len(out['items'])} Inserate ({with_geo} mit Lage), {kept} aus altem Stand, "
        f"{len(out['failed'])} Teile unvollständig, {time.time() - t0:.0f} s")
    if old and len(out["items"]) < 0.85 * len(old) and not blocked:
        log(f"ABBRUCH: nur {len(out['items'])} statt bisher {len(old)} – alter Stand bleibt")
        sys.exit(4)
    save_gz(a.out, out)
    if blocked:
        sys.exit(3)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("crawl")
    c.add_argument("--source", choices=["ph", "rh"], required=True)
    c.add_argument("--state", default="")
    c.add_argument("--out", required=True)
    a = ap.parse_args()
    cmd_crawl(a)


if __name__ == "__main__":
    main()
