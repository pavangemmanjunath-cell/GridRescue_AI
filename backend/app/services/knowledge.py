"""Small internal database + retrieval (RAG) for GridRescue AI.

* **Internal DB** — one SQLite file (Python standard library, no server): a ``documents`` table with an FTS5 full-text
  index (BM25 ranking, Porter stemming) holding the app's own knowledge, and an ``assessments`` table with a short
  record of every site the engine has assessed (place, design, ML pick, CO₂).
* **Retrieval-augmented answers** — ``ask()`` retrieves the best passages for a question (plus the user's current
  assessment, if given) and builds the answer *only* from those passages, with numbered citations. No language model
  is used yet: the generator is extractive. ``generate()`` is the single place where an LLM can be plugged in later
  (set ``GR_LLM_PROVIDER``); the retrieval, sources and citations stay the same.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
from pathlib import Path

from app.config import DATA_DIR, settings

_LOCK = threading.Lock()
_CONN: sqlite3.Connection | None = None
KB_VERSION = "kb-3"   # raise when the knowledge changes; the documents are rebuilt on the next start


def db_path() -> Path:
    p = Path(os.environ.get("GR_DB_PATH") or (Path(settings.cache_dir) / "gridrescue.db"))
    if not p.is_absolute():
        p = Path(__file__).resolve().parents[2] / p
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _conn() -> sqlite3.Connection:
    global _CONN
    if _CONN is None:
        c = sqlite3.connect(db_path(), check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.executescript("""
          CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
          CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, kind TEXT, title TEXT, body TEXT, source TEXT, url TEXT);
          CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(title, body, content='documents', content_rowid='id', tokenize='porter unicode61');
          CREATE TABLE IF NOT EXISTS assessments (
            id INTEGER PRIMARY KEY, key TEXT UNIQUE, place TEXT, country TEXT, lat REAL, lng REAL, facility TEXT, facility_type TEXT,
            design TEXT, ml_family TEXT, ml_confidence REAL, ml_agrees INTEGER, critical_pct REAL, co2_t REAL, diesel_l REAL, capex_usd REAL,
            backup_hours REAL, runs INTEGER DEFAULT 1);
        """)
        _CONN = c
        _ensure_documents(c)
    return _CONN


# ── the knowledge: built from the app's own data, every passage with its source ────────────────────────────────────
def _docs() -> list[dict]:
    from app.engine.catalogue import REFERENCES, TECHNOLOGIES
    from app.engine.profiles import FACILITY_TYPES
    from app.services.open_data import sources

    docs: list[dict] = []
    add = lambda kind, title, body, source, url=None: docs.append({"kind": kind, "title": title, "body": body, "source": source, "url": url})  # noqa: E731

    for k, t in TECHNOLOGIES.items():
        add("technology", t["name"],
            f"{t['name']} ({t['category']}). Typical duration {t['duration_h'][0]:g}–{t['duration_h'][1]:g} h; response {t['response']}; "
            f"round-trip efficiency {round(t['rte'] * 100)} %; life about {t['life_years']} years and {t['cycle_life']:,} cycles; "
            f"about US$ {t['capex_usd_per_kw']:,}/kW and US$ {t['capex_usd_per_kwh']:,}/kWh. Footprint: {t['footprint']}. Site needs: {t['site_needs']}. "
            f"{t['nigeria_note']}", "GridRescue technology catalogue (NREL ATB, Lazard LCOS, IRENA, BNEF)")
    for r in REFERENCES:
        add("reference", r["title"], f"Cost and performance reference used by the engine: {r['title']}.", "Reference library", r.get("url"))
    for k, f in FACILITY_TYPES.items():
        add("infrastructure", f["label"],
            f"{f['label']}: about {round(f.get('critical_share', 0.4) * 100)} % of the load is critical and must never lose power. "
            f"The engine sizes the backup for the protected (critical + essential) load of this kind of site, and the ML model "
            f"knows the kind of infrastructure as one of its features.", "GridRescue load profiles")
    tariffs = json.loads((DATA_DIR / "tariffs.json").read_text(encoding="utf-8"))
    for cc, c in tariffs.get("countries", {}).items():
        states = "; ".join(f"{s}: {v.get('label')} at {c.get('symbol', '')}{v.get('rate_per_kwh')}/kWh ({v.get('source')})"
                           for s, v in (c.get("states") or {}).items())
        add("tariff", f"Electricity tariff — {c.get('name', cc)}",
            f"{c.get('name', cc)}: {c.get('label')} at {c.get('symbol', '')}{c.get('rate_per_kwh')}/kWh. {c.get('night_note') or ''} "
            f"Source: {c.get('source')}. {('States: ' + states) if states else ''}", "Published tariffs (tariffs.json)")
    for s in sources():
        add("data source", s["name"], f"{s['name']} ({s['group']}): {s['use']}. Status in the app: {s['status']}. Endpoint: {s.get('route') or '—'}.",
            "Data sources")
    case = json.loads((DATA_DIR / "cases" / "noh_enugu.json").read_text(encoding="utf-8"))
    b, h = case["brief"], case["hospital"]
    add("case", f"Brief {b['number']} — {b['title']}",
        f"Global Energy Hackathon Brief {b['number']} ({b['track']}): {b['title']}. Focus region {b.get('focus_region', '')}. {b.get('persona', '')}",
        "GEH Brief 12")
    add("case", h["name"], f"{h['name']}, {h.get('address', '')}: about {h.get('beds', '—')} beds, about {h.get('connected_kw', '—')} kW connected, "
        f"grid about {case['options'].get('supply_hours_override', '—')} h a day as reported by the hospital, moving to a new building in about "
        f"{h.get('move_in_years', 5)} years.", "GEH Brief 12 · the hospital's head engineer")
    for p in case.get("prices", []):
        add("price", p["label"], f"{p['label']}: {p['value']}. Source: {p['source']}.", "GEH Brief 12 prices")
    for i in case.get("inputs_to_confirm", []):
        add("case", f"To confirm: {i['label']}", f"{i['label']}: {i['value']}. Why it matters: {i['why']}", "GEH Brief 12 · inputs to confirm")
    for r in case.get("references", []):
        add("reference", r["title"], f"Brief 12 reference [{r['id']}]: {r['title']}.", "GEH Brief 12 references", r.get("url"))

    for title, body in METHOD:
        add("method", title, body, "GridRescue AI method")
    try:
        from app.ml import backup_classifier
        card = backup_classifier.model_card()
        if card.get("available"):
            m = card["meta"]
            top = ", ".join(f"{i['label']}" for i in card["importance"][:6])
            add("method", "The ML model — Random Forest classifier",
                f"{card['kind']}. Trained on {m['n_train']:,} engine-labelled synthetic sites across {len(m.get('infrastructure_types', []))} kinds of infrastructure "
                f"and tested on {m['n_test']:,} unseen ones: {m['accuracy_test'] * 100:.1f} % correct (top-2 {m['top2_accuracy_test'] * 100:.1f} %), "
                f"against {m.get('cart_accuracy_test', 0) * 100:.1f} % for a single decision tree and {m['majority_baseline_test'] * 100:.1f} % for always "
                f"guessing the most common answer. Most important inputs: {top}. The hourly simulation verifies every pick.", "Model card (/api/ml/model)")
    except Exception:   # the knowledge base must build even without a trained model
        pass
    return docs


METHOD: list[tuple[str, str]] = [
    ("How GridRescue AI selects the energy system",
     "The engine reads the site (sun, wind, water, grid strength and supply hours), builds the facility's load (critical, essential, "
     "non-essential), sizes nine candidate architectures, simulates each one hour by hour through the outage, and scores them on nine "
     "criteria: response speed, duration fit, site suitability, capital cost, lifecycle cost, simplicity, healthcare suitability, clean "
     "share and expansion. Weights follow the chosen priority (balanced, cheapest, greenest, most reliable, longest backup). A Random "
     "Forest classifier gives a fast first pick, and the hourly simulation verifies it."),
    ("Stress tests",
     "Every design is stress-tested on four outage cases: the design outage (12 h evening), a 24 h national grid collapse, the worst "
     "solar month and a longer 18 h outage. A design passes only if the critical load is served in all four; if a test fails, the agent "
     "proposes a mitigation."),
    ("Outage types on the map",
     "In the Explorer a user can simulate evening load-shedding (6 h), an overnight outage (12 h), a national grid collapse (24 h) or a "
     "daytime feeder fault (4 h). Grid-level outage groups, location-based outage groups and cyber-security outages that cut power or "
     "controls are extensions planned as further stress scenarios."),
    ("Access, Affordability, Availability",
     "Access: any site can be read in seconds from open data, and the new-site lens ranks where a moving hospital should go by grid access. "
     "Affordability: every storage family is compared on cost for this site, and energy-as-a-service needs no upfront capital, paid from the "
     "diesel budget. Availability: a 0 ms UPS on the theatres, storage through the night, diesel last; the system moves with the hospital."),
    ("ESG report",
     "The ESG report is a forecast before purchase for the selected site: Scope 1 is diesel burnt on site (2.68 kg CO₂ per litre, IPCC "
     "default), Scope 2 is grid electricity displaced by on-site solar at the national grid factor. It lists Environment, Social and "
     "Governance lines and values carbon credits only at a price the buyer enters; avoided tonnes become credits only after a registered "
     "methodology, verification and issuance."),
    ("Lenses: sun, wind and water",
     "The sun lens shows peak-sun hours month by month from NASA POWER, PVGIS, PVWatts and the Global Solar Atlas. The wind lens shows "
     "50 m wind speed and an hourly wind rose. The water lens shows rainfall, the nearest river and its discharge, and terrain head, for "
     "hydrogen or river-linked designs. On the Simulate page the lens picks the design that uses that resource when it is viable."),
    ("Relocation — a hospital on the move",
     "When the hospital is moving, the new-site lens ranks areas within 12 km by grid access and move distance. The plan answers Brief 12's "
     "five questions: which loads never lose power, how the system moves (ground-mounted solar and battery containers), who owns it "
     "(energy-as-a-service, nothing on the federal asset register), whether diesel savings repay it, and which funders back similar projects."),
    ("When storage cannot be afforded yet",
     "If storage cannot be afforded yet, the plan adapts: grid first, a dedicated feeder from the nearest substation where possible, a UPS on "
     "the theatres, and storage added later."),
    ("How it scales",
     "Sun, weather, rivers and grid come from global open datasets, so any pin on the map works; a new country needs only its tariff table. "
     "The planner is vendor-neutral and sells no hardware. Next: meter telemetry, utility feeder planning, cold storage, surplus solar shared "
     "with the grid where tariffs allow, and car-park charging."),
    ("Security and data",
     "No API keys or secrets are needed and no personal data is collected: inputs are a map pin and facility figures. Every input is validated "
     "on the server; offline mode runs from bundled snapshots; every number shows its source. A production deployment adds sign-in, HTTPS, "
     "rate limiting and audit logs."),
    ("Ask GridRescue — how the answers are made",
     "Answers come from retrieval over GridRescue's internal knowledge base (SQLite full-text search with BM25 ranking). The answer is built "
     "only from the retrieved passages and cites them. No language model is used yet; one can be connected later without changing the "
     "retrieval or the sources."),
]


def _ensure_documents(c: sqlite3.Connection) -> None:
    row = c.execute("SELECT v FROM meta WHERE k='kb_version'").fetchone()
    if row and row["v"] == KB_VERSION and c.execute("SELECT count(*) FROM documents").fetchone()[0]:
        return
    rebuild(c)


def rebuild(c: sqlite3.Connection | None = None) -> int:
    c = c or _conn()
    with _LOCK:
        c.execute("DELETE FROM documents")
        c.execute("INSERT INTO documents_fts(documents_fts) VALUES('delete-all')")
        for d in _docs():
            cur = c.execute("INSERT INTO documents(kind, title, body, source, url) VALUES (?,?,?,?,?)", (d["kind"], d["title"], d["body"], d["source"], d["url"]))
            c.execute("INSERT INTO documents_fts(rowid, title, body) VALUES (?,?,?)", (cur.lastrowid, d["title"], d["body"]))
        c.execute("INSERT OR REPLACE INTO meta(k, v) VALUES ('kb_version', ?)", (KB_VERSION,))
        c.commit()
        return c.execute("SELECT count(*) FROM documents").fetchone()[0]


# ── retrieval ─────────────────────────────────────────────────────────────────────────────────────────────────────────
STOP = set("a an the of to in on for and or is are be by with what which how why when where who does do can i we my our this that it its at as from".split())


def _terms(q: str) -> list[str]:
    q = q.lower().replace("₂", "2")   # CO₂ and CO2 are the same word
    return [w for w in re.findall(r"[a-z0-9]+", q) if w not in STOP and len(w) > 1]


def search(q: str, k: int = 6) -> list[dict]:
    terms = _terms(q)
    if not terms:
        return []
    alt = {"co2": '"co₂"'}   # the documents write CO₂
    match = " OR ".join([f'"{t}"*' if len(t) > 3 else f'"{t}"' for t in terms] + [alt[t] for t in terms if t in alt])
    c = _conn()
    rows = c.execute("""SELECT d.id, d.kind, d.title, d.body, d.source, d.url, bm25(documents_fts, 4.0, 1.0) AS score
                        FROM documents_fts JOIN documents d ON d.id = documents_fts.rowid
                        WHERE documents_fts MATCH ? ORDER BY score LIMIT ?""", (match, k)).fetchall()
    return [{"id": r["id"], "kind": r["kind"], "title": r["title"], "text": r["body"], "source": r["source"], "url": r["url"],
             "score": round(-r["score"], 3)} for r in rows]


def stats() -> dict:
    c = _conn()
    kinds = {r["kind"]: r["n"] for r in c.execute("SELECT kind, count(*) AS n FROM documents GROUP BY kind ORDER BY n DESC")}
    return {"documents": sum(kinds.values()), "by_kind": kinds, "assessments": c.execute("SELECT count(*) FROM assessments").fetchone()[0],
            "engine": "SQLite FTS5 · BM25 · Porter stemming", "db": db_path().name, "version": KB_VERSION}


def _sentences(text: str) -> list[str]:
    text = re.sub(r"\s*\[\d+(?:\]\[\d+)*\]", "", text)   # a passage's own reference marks are not the answer's citations
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9₦])", text) if len(s.strip()) > 20]


def generate(question: str, passages: list[dict]) -> tuple[str, str]:
    """Build the answer from the retrieved passages only. Extractive today; the hook for a language model later.

    The answer leads with the opening of the best-ranked explanatory passage (BM25 already weighs its title), then adds
    the sentences of the next passages that share the most words with the question. Reference-list entries are cited as
    sources but not quoted as explanations."""
    if os.environ.get("GR_LLM_PROVIDER"):
        pass   # an LLM would be called here with the question and the numbered passages; not enabled in this build
    if not passages:
        return ("I could not find this in GridRescue's knowledge base. Try asking about the selection method, outages, the ESG report, "
                "tariffs, a technology or the Brief 12 case.", "none")
    stem = lambda w: w[:5]   # noqa: E731 — light stemming so "batteries" meets "battery"
    tstem = {stem(t) for t in _terms(question)}
    explain = [i for i, p in enumerate(passages) if p["kind"] != "reference"] or list(range(len(passages)))
    lead = _sentences(passages[explain[0]]["text"])
    # the lead passage: its sentences that share words with the question first, else its opening
    ranked = sorted(range(len(lead)), key=lambda j: (-len(tstem & {stem(w) for w in _terms(lead[j])}), j))
    picked: list[tuple[str, int]] = [(lead[j], explain[0]) for j in sorted(ranked[:2])]
    need = 2 if len(tstem) >= 3 else 1   # a supporting sentence must share enough of the question's words
    scored = []
    for rank, i in enumerate(explain[1:], start=1):
        for j, x in enumerate(_sentences(passages[i]["text"])):
            hit = len(tstem & {stem(w) for w in _terms(x)})
            if hit >= need:
                scored.append((hit * 2 - rank * 0.4 - j * 0.1, i, x))
    scored.sort(key=lambda t: -t[0])
    seen = {x for x, _ in picked}
    for _, i, x in scored:
        if len(picked) >= 4:
            break
        if x not in seen:
            seen.add(x)
            picked.append((x, i))
    return " ".join(f"{x} [{i + 1}]" for x, i in picked), "extractive"


def ask(question: str, context: dict | None = None, k: int = 5) -> dict:
    passages = search(question, k)
    if context:   # the user's own assessment is the first passage, so answers about "this site" cite it
        ctx = {"id": 0, "kind": "your assessment", "title": f"Your assessment — {context.get('place', 'this site')}",
               "text": " ".join(str(v) for v in context.get("facts", []) if v), "source": "This session's assessment", "url": None, "score": None}
        about_site = re.search(r"\b(this|my|our|here|site|hospital|facility)\b", question.lower())
        shared = len({w[:5] for w in _terms(question)} & {w[:5] for w in _terms(ctx["text"])})
        if ctx["text"] and about_site:
            passages = [ctx] + passages[: k - 1]          # a question about "this site": the user's assessment leads
        elif ctx["text"] and shared >= 2:
            passages = passages[: k - 1] + [ctx]          # related: cited as a supporting source

    answer, mode = generate(question, passages)
    return {"question": question, "answer": answer, "mode": mode,
            "generator": "extractive (no language model) — answers are built only from the cited passages",
            "llm_enabled": False, "sources": [{**p, "n": i + 1} for i, p in enumerate(passages)]}


# ── assessment history ────────────────────────────────────────────────────────────────────────────────────────────────
def record_assessment(a: dict) -> None:
    """Keep a short record of an assessed site (one row per site + facility + backup hours; re-runs update it)."""
    try:
        loc, fac, rec = a["location"], a["inputs"]["facility"], a["recommended"]
        ml = (a.get("agent") or {}).get("ml") or {}
        inv = (a.get("investment_case") or {}).get("investment") or {}
        from app.ml.backup_classifier import family_of
        key = f"{round(loc['lat'], 3)},{round(loc['lng'], 3)}|{fac.get('type')}|{fac.get('name') or ''}|{fac.get('backup_hours')}"
        row = (key, loc.get("name"), loc.get("country"), loc["lat"], loc["lng"], fac.get("name") or a["inputs"].get("facility_label"), fac.get("type"),
               rec.get("name"), ml.get("family_label"), ml.get("confidence"), 1 if ml and ml.get("family") == family_of(rec.get("parts", [])) else 0,
               rec.get("simulation_summary", {}).get("critical_served_pct"), inv.get("co2_avoided_t_per_year"), inv.get("diesel_avoided_l_per_year"),
               rec.get("cost", {}).get("capex_usd"), fac.get("backup_hours"))
        c = _conn()
        with _LOCK:
            c.execute("""INSERT INTO assessments(key, place, country, lat, lng, facility, facility_type, design, ml_family, ml_confidence, ml_agrees,
                           critical_pct, co2_t, diesel_l, capex_usd, backup_hours) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                         ON CONFLICT(key) DO UPDATE SET design=excluded.design, ml_family=excluded.ml_family, ml_confidence=excluded.ml_confidence,
                           ml_agrees=excluded.ml_agrees, critical_pct=excluded.critical_pct, co2_t=excluded.co2_t, diesel_l=excluded.diesel_l,
                           capex_usd=excluded.capex_usd, runs=assessments.runs + 1""", row)
            c.commit()
    except Exception:   # history is a convenience; it must never break an assessment
        pass


def history(limit: int = 12) -> list[dict]:
    rows = _conn().execute("SELECT * FROM assessments ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [{k: r[k] for k in r.keys() if k != "key"} for r in rows]
