"""Sehenswürdigkeiten für ganz Thailand aus Wikidata -> site/data/sights/<lat>_<lng>.json (1°-Zellen).

Nur Orte mit eigenem Artikel in der englischen oder deutschen Wikipedia (= bekannt): Tempel, Wasserfälle, Museen,
Nationalparks, Aussichtspunkte, Höhlen, Inseln, historische Stätten, Zoos/Freizeitparks, Touristenattraktionen.
Overpass (OSM) war mehrfach überlastet; Wikidata hat dieselben Orte mit Koordinaten.
Aufruf:  python3 scraper/sights.py
"""
import json, math, os, subprocess, time
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "site", "data", "sights")
UA = "ThailandWohnen/1.0 (https://tugi01.github.io/krabi-wohnen/)"

KINDS = {   # Wikidata-Klasse -> Anzeige (Auswahl nach den häufigsten Arten bekannter Orte in Thailand)
    "Q427287": "Tempel (Wat)", "Q13016741": "Khmer-Tempel", "Q5393308": "Tempel", "Q842402": "Tempel",
    "Q95080679": "Nationalpark", "Q46169": "Nationalpark", "Q13020522": "Waldpark", "Q1377575": "Naturschutzgebiet",
    "Q17334112": "Geschichtspark", "Q839954": "Archäologische Stätte", "Q109607": "Ruine", "Q16560": "Palast", "Q4989906": "Denkmal",
    "Q33506": "Museum", "Q207694": "Kunstmuseum", "Q17431399": "Museum",
    "Q34038": "Wasserfall", "Q35509": "Höhle", "Q40080": "Strand", "Q23442": "Insel", "Q33837": "Inselgruppe", "Q39594": "Bucht",
    "Q8502": "Berg", "Q6017969": "Aussichtspunkt", "Q22698": "Park", "Q167346": "Botanischer Garten",
    "Q43501": "Zoo", "Q2281788": "Aquarium", "Q194195": "Freizeitpark", "Q1945774": "Schwimmender Markt", "Q570116": "Sehenswürdigkeit",
}


def sparql(q):
    last = ""
    for i in range(4):
        r = subprocess.run(["curl", "-s", "-m", "120", "-G", "https://query.wikidata.org/sparql", "-H", "Accept: application/sparql-results+json",
                            "-A", UA, "--data-urlencode", f"query={q}"], capture_output=True, text=True)
        if r.stdout.startswith("{"):
            return json.loads(r.stdout)["results"]["bindings"]
        last = r.stdout[:200]
        time.sleep(10 * (i + 1))
    raise RuntimeError("Wikidata nicht erreichbar: " + last)


def main():
    items = {}
    for cls, kind in KINDS.items():          # je Art eine kleine Abfrage (eine große läuft in die Zeitgrenze)
        q = f"""SELECT ?item ?coord ?de ?en ?th WHERE {{
          ?item wdt:P31 wd:{cls}; wdt:P17 wd:Q869; wdt:P625 ?coord.
          FILTER EXISTS {{ ?art schema:about ?item; schema:isPartOf ?wp. FILTER(?wp IN (<https://en.wikipedia.org/>, <https://de.wikipedia.org/>)) }}
          OPTIONAL {{ ?item rdfs:label ?de FILTER(LANG(?de)="de") }}
          OPTIONAL {{ ?item rdfs:label ?en FILTER(LANG(?en)="en") }}
          OPTIONAL {{ ?item rdfs:label ?th FILTER(LANG(?th)="th") }}
        }}"""
        rows = sparql(q)
        n0 = len(items)
        for b in rows:
            name = (b.get("de") or b.get("en") or b.get("th") or {}).get("value")
            c = b["coord"]["value"]
            if not name or not c.startswith("Point("):
                continue
            lng, lat = map(float, c[6:-1].split())
            items.setdefault(b["item"]["value"], [round(lat, 5), round(lng, 5), name, kind])
        print(kind, cls, len(items) - n0, flush=True)
        time.sleep(1)
    by = defaultdict(list)
    for v in items.values():
        if 5 <= v[0] <= 21 and 97 <= v[1] <= 106:
            by[f"{math.floor(v[0])}_{math.floor(v[1])}"].append(v)
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))
    for cid, vs in by.items():
        json.dump(vs, open(os.path.join(OUT, cid + ".json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    n = sum(len(v) for v in by.values())
    json.dump({"cells": sorted(by), "count": n, "source": "Wikidata"}, open(os.path.join(OUT, "index.json"), "w"), separators=(",", ":"))
    print(n, "Sehenswürdigkeiten in", len(by), "Zellen", Counter(v[3] for vs in by.values() for v in vs).most_common())


if __name__ == "__main__":
    main()
