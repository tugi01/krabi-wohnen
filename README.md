# Krabi Wohnen

Persönliche Web-App (PWA) mit Mietinseraten in Ao Nang / Mueang Krabi.

- `scraper/scrape.py` lädt Inserate von DotProperty (inkl. FazWaz-Inserate) und der
  Vermieterseite aonangapartments.com, berechnet Straßen-km zu Strand, Moschee,
  Muay-Thai-Gym und Einkauf (OSRM) und schreibt `site/data/listings.json`.
- Eine GitHub Action läuft zweimal täglich, entfernt verschwundene Inserate,
  markiert neue und veröffentlicht `site/` über GitHub Pages.
- Filter: ältere Gebäude (> 5 Jahre, nicht kernsaniert) ein/aus, nur mit Pool,
  Baujahr unbekannt, bald frei, Fläche, Miete, Strandnähe; Merkliste lokal im Browser.

Alle Angaben stammen aus den Inseraten und sind nicht vom Vermieter bestätigt.
