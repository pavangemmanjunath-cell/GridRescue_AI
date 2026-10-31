"""POST /api/report — render a printable HTML report from an assessment payload."""
from __future__ import annotations

import html
from typing import Any

from fastapi import APIRouter, Body
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["report"])


def _fmt_usd(v: float | None) -> str:
    if v is None:
        return "—"
    return f"US$ {v:,.0f}"


def _esc(v: Any) -> str:
    return html.escape(str(v))


def _brief12_section(rc: dict | None) -> str:
    """Brief 12 — relocatable solar for a hospital on the move: answers, phases, move, money, impact."""
    if not rc:
        return ""
    qa = "".join(f"<h3>{_esc(q['question'])}</h3><p>{_esc(q['answer'])}</p>" for q in rc.get("starter_answers", []))
    phases = "".join(f"<tr><td>{_esc(p['name'])}</td><td>{_esc(p['when'])}</td><td>{p['protects_kw']:,} kW</td><td>{_esc(p['loads'])}</td><td>{_fmt_usd(p['capex_usd'])}</td></tr>"
                     for p in rc.get("phases", []))
    cm = rc["cost_model"]
    years = "".join(f"<tr><td>Year {y['year']}</td><td>₦{y['diesel_ngn_m']:,.0f} M</td><td>₦{y['grid_ngn_m']:,.0f} M</td><td>₦{y['solar_ngn_m']:,.0f} M</td><td>₦{y['saving_vs_diesel_ngn_m']:,.0f} M</td></tr>"
                    for y in (cm["at_5"], cm["at_10"]))
    funders = "".join(f"<li><b>{_esc(f['name'])}</b> — {_esc(f['case'])}</li>" for f in rc.get("funders", []))
    metrics = "".join(f"<tr><td>{_esc(m['title'])} · {m['weight']} %</td><td>{'<br>'.join(_esc(x) for x in m['ours'])}</td></tr>" for m in rc.get("metrics", []))
    mv, own = rc["move_plan"], rc["ownership"]
    return f"""
<h2>Brief 12 — {_esc(rc['brief']['title'])}</h2>
<p class="sub">{_esc(rc['facility'])} · Global Energy Hackathon · {_esc(rc['brief']['track'])}</p>
{qa}
<h2>Phased build — theatres first</h2>
<table><tr><th>Phase</th><th>When</th><th>Protects</th><th>Loads</th><th>Investment</th></tr>{phases}</table>
<h2>Move plan</h2>
<p>Year {mv['year']} · {mv['distance_km']} km · {_esc(mv['duration'])} · cost ₦{mv['cost_ngn_m']:,.0f} M ({mv['cost_pct']} % of the investment) ·
 {mv['reuse_pct']} % reused at the new building · a rooftop system would have stranded ₦{mv['stranded_if_rooftop_ngn_m']:,.0f} M.</p>
<h2>Ownership and money</h2>
<p>Energy-as-a-service: ₦{own['fee_ngn_m_per_month']:,.1f} M a month (₦{own['fee_ngn_per_kwh']:,}/kWh vs diesel ₦{own['diesel_ngn_per_kwh']:,}/kWh), no upfront capital,
 nothing on the federal asset register. {_esc(own['financing'])}.</p>
<table><tr><th></th><th>Diesel + grid today</th><th>Grid only (24 h, reference)</th><th>Solar + storage service</th><th>Saving vs diesel</th></tr>{years}</table>
<p class="sub">{_esc(cm['basis'])}</p>
<h2>Funders</h2><ul>{funders}</ul>
<h2>Impact estimate — the brief's success metrics</h2>
<table><tr><th>Metric</th><th>GridRescue AI for this hospital</th></tr>{metrics}</table>"""


@router.post("/report", response_class=HTMLResponse, summary="Printable HTML report for an assessment result")
async def report(assessment: dict = Body(...)):
    a = assessment
    loc = a.get("location", {})
    site = a.get("site", {})
    load = a.get("load", {})
    rec = a.get("recommended", {})
    comp = rec.get("components", {})
    cost = rec.get("cost", {})
    life = rec.get("lifecycle", {})
    sim = rec.get("simulation_summary", {})
    ranked = a.get("ranked", [])
    fac = a.get("inputs", {}).get("facility", {})

    def row(label: str, value: Any) -> str:
        return f"<tr><td>{_esc(label)}</td><td><b>{_esc(value)}</b></td></tr>"

    sizing_rows = []
    if comp.get("ups"):
        sizing_rows.append(row("UPS (critical circuits)", f"{comp['ups']['kva']} kVA, 15 min"))
    if comp.get("pv"):
        sizing_rows.append(row("Solar PV", f"{comp['pv']['kwp']:.0f} kWp ({comp['pv']['area_m2']:.0f} m²)"))
    if comp.get("wind") and comp["wind"].get("kw"):
        sizing_rows.append(row("Wind turbine", f"{comp['wind']['kw']} kW"))
    if comp.get("backup_device"):
        b = comp["backup_device"]
        sizing_rows.append(row(f"Storage ({b['chemistry'].replace('_', '-')})", f"{b['energy_kwh']:,.0f} kWh / {b['power_kw']:,.0f} kW — {b['autonomy_h']} h autonomy"))
    if comp.get("hydrogen"):
        h = comp["hydrogen"]
        sizing_rows.append(row("Hydrogen", f"{h['h2_kg']:.0f} kg H₂, {h['electrolyser_kw']:.0f} kW electrolyser, {h['fuel_cell_kw']:.0f} kW fuel cell"))
    if comp.get("generator"):
        g = comp["generator"]
        sizing_rows.append(row("Generator", f"{g['kva']:.0f} kVA ({'existing' if g.get('existing') else 'new'})"))

    reasons = "".join(f"<li>{_esc(r.get('text'))}</li>" for r in rec.get("reasons", []))
    comp_rows = "".join(
        f"<tr><td>{r.get('rank', '')}</td><td>{_esc(r['name'])}</td><td>{r['autonomy_h']} h</td><td>{_fmt_usd(r['cost']['capex_usd'])}</td>"
        f"<td>{_fmt_usd(r['lifecycle']['system_opex_usd_per_year'])}/yr</td><td>{r['simulation_summary']['renewable_share_pct']} %</td>"
        f"<td>{r['score']}</td><td>{_esc(r['suitability'])}</td></tr>" for r in ranked)
    cost_rows = "".join(f"<tr><td>{_esc(c['category'])}</td><td>{_fmt_usd(c['usd'])}</td><td>{c['pct']} %</td></tr>" for c in cost.get("breakdown", []))
    brief12 = _brief12_section(a.get("relocatable_case"))

    doc = f"""<!doctype html><html><head><meta charset="utf-8"><title>GridRescue AI — Resilience assessment</title>
<style>
 body{{font-family:'Segoe UI',system-ui,sans-serif;color:#0B1A2E;margin:40px;line-height:1.45}}
 h1{{font-size:26px;margin:0 0 4px}} h2{{font-size:17px;border-bottom:2px solid #D4A056;padding-bottom:4px;margin-top:28px}} h3{{font-size:14px;margin:14px 0 2px}}
 .sub{{color:#5B6B85;font-size:13px}} table{{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}}
 td,th{{border:1px solid #D9E0EA;padding:6px 8px;text-align:left}} th{{background:#F3F6FB}}
 .badge{{display:inline-block;background:#0B1A2E;color:#F0CB72;padding:6px 12px;border-radius:6px;font-weight:700;font-size:16px}}
 .grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:10px}}
 .kpi{{border:1px solid #D9E0EA;border-radius:8px;padding:10px}} .kpi b{{font-size:20px;display:block}}
 .foot{{margin-top:32px;font-size:11px;color:#5B6B85}} @media print{{body{{margin:16px}}}}
</style></head><body>
<h1>GridRescue AI — Energy resilience assessment</h1>
<div class="sub">{_esc(a.get('inputs', {}).get('facility_label', ''))} · {_esc(loc.get('name', ''))}, {_esc(loc.get('state') or '')} {_esc(loc.get('country', ''))} ·
 {loc.get('lat')}°, {loc.get('lng')}° · engine {_esc(a.get('engine', {}).get('mode', ''))} mode</div>
<h2>Recommended architecture</h2>
<p><span class="badge">{_esc(rec.get('name', ''))}</span> &nbsp; score {rec.get('score')} / 100 · suitability {_esc(rec.get('suitability', ''))}</p>
<div class="grid">
 <div class="kpi"><b>{load.get('protected_peak_kw')} kW</b>protected peak load</div>
 <div class="kpi"><b>{fac.get('backup_hours')} h</b>backup target</div>
 <div class="kpi"><b>{_fmt_usd(cost.get('capex_usd'))}</b>estimated CAPEX</div>
 <div class="kpi"><b>{sim.get('critical_served_pct')} %</b>critical load served in simulation</div>
</div>
<h2>Site summary</h2>
<table>
{row('Solar resource', f"{site.get('solar', {}).get('annual_psh')} PSH/day — {site.get('solar', {}).get('label')} ({site.get('solar', {}).get('score')}/100)")}
{row('Wind resource', f"{site.get('wind', {}).get('annual_ws50')} m/s at 50 m — {site.get('wind', {}).get('label')} ({site.get('wind', {}).get('score')}/100)")}
{row('Water / river', f"{site.get('water', {}).get('discharge_class')} at {site.get('water', {}).get('nearest_km')} km, head ≈ {site.get('water', {}).get('head_m')} m, rain {site.get('water', {}).get('rain_mm_yr')} mm/yr")}
{row('Grid reliability', f"Class {site.get('grid', {}).get('class')} ({site.get('grid', {}).get('label')}) — ≈ {site.get('grid', {}).get('supply_hours')} h/day supply, outage risk {site.get('grid', {}).get('outage_risk')}")}
{row('DisCo / state', f"{site.get('grid', {}).get('disco') or '—'} / {site.get('grid', {}).get('state') or '—'}")}
</table>
<h2>Why this is recommended</h2><ul>{reasons}</ul>
<h2>Suggested sizing</h2><table>{''.join(sizing_rows)}</table>
<h2>Cost breakdown (CAPEX {_fmt_usd(cost.get('capex_usd'))} ≈ ₦{cost.get('capex_ngn', 0):,.0f})</h2>
<table><tr><th>Category</th><th>USD</th><th>Share</th></tr>{cost_rows}</table>
<p class="sub">OPEX {_fmt_usd(life.get('system_opex_usd_per_year'))}/yr · 15-year total {_fmt_usd(life.get('total_cost_15y_usd'))} · diesel-only baseline {_fmt_usd(life.get('baseline_diesel_usd_15y'))} ·
 simple payback {life.get('simple_payback_years') or '—'} yr · cost per resilient kWh {life.get('cost_per_resilient_kwh_usd')} US$/kWh</p>
<h2>Option comparison</h2>
<table><tr><th>#</th><th>Option</th><th>Autonomy</th><th>CAPEX</th><th>OPEX</th><th>Clean share</th><th>Score</th><th>Suitability</th></tr>{comp_rows}</table>
{brief12}
<div class="foot">Data: Open-Meteo (ERA5, GloFAS flood API, elevation), NASA POWER, PVGIS-SARAH2, OpenStreetMap/Overpass, World Bank. Costs: NREL ATB 2024, Lazard LCOS 2024, IRENA 2023, BNEF 2024.
 Pre-feasibility decision support (±30 %). Not a substitute for an engineering study.</div>
</body></html>"""
    return HTMLResponse(doc)


DIESEL_KG_PER_L = 2.68   # IPCC default for diesel, the factor the engine uses


def pick_option(a: dict, option_id: str | None) -> tuple[dict, bool]:
    """The design the report is about: the recommended one, or another ranked design (e.g. the best wind or water
    design when the user looks through that lens). Returns (option, is_recommended)."""
    rec = a.get("recommended") or {}
    if not option_id or option_id == rec.get("id"):
        return rec, True
    return next((o for o in a.get("ranked") or [] if o.get("id") == option_id), rec), False


def esg_figures(a: dict, option_id: str | None = None) -> dict:
    """The ESG numbers for one assessment, split by GHG Protocol scope. Every figure comes from the engine's own result:
    the plan's ESG block when the relocation plan ran, else the investment case of the general assessment; for another
    ranked design the same formula is applied to that design's own simulation."""
    inv_case = a.get("investment_case") or {}
    inv, base = inv_case.get("investment") or {}, inv_case.get("do_nothing") or {}
    asm = inv_case.get("assumptions") or {}
    opt, is_rec = pick_option(a, option_id)
    if not is_rec:
        sim, life = opt.get("simulation_summary") or {}, opt.get("lifecycle") or {}
        diesel_today = float(base.get("diesel_litres_per_year") or (life.get("outage_kwh_per_year", 0) * 0.32))
        avoided = max(0.0, diesel_today - float(sim.get("fuel_l", 0) or 0) * 365)
        gf = float(asm.get("grid_kg_co2_per_kwh") or 0.45)
        rows = opt.get("simulation_hourly") or []   # same method as the engine: grid electricity no longer bought while it is on
        grid_saved = (sum(r["load_kw"] - r["grid_import_kw"] for r in rows if r["grid_available"]) if len(rows) == 24
                      else (float(sim.get("pv_used_kwh", 0) or 0) + float(sim.get("wind_used_kwh", 0) or 0)) * float(a.get("site", {}).get("grid", {}).get("supply_hours", 0) or 0) / 24)
        inv = {"co2_avoided_t_per_year": round(max(0.0, avoided * DIESEL_KG_PER_L / 1000 + grid_saved * 365 * gf / 1000), 1), "diesel_avoided_l_per_year": round(avoided),
               "renewable_share_pct": sim.get("renewable_share_pct", 0), "critical_served_pct": sim.get("critical_served_pct", 0)}
    rc_esg = ((a.get("relocatable_case") or {}).get("esg") or {}) if is_rec else {}
    rec_sim = opt.get("simulation_summary") or {}
    co2_y = float(rc_esg.get("co2_t_per_year", inv.get("co2_avoided_t_per_year", 0)) or 0)
    diesel_avoided = float(rc_esg.get("diesel_l_per_year", inv.get("diesel_avoided_l_per_year", 0)) or 0)
    diesel_today = float(base.get("diesel_litres_per_year", diesel_avoided) or 0)
    s1_today = diesel_today * DIESEL_KG_PER_L / 1000
    s1_avoided = diesel_avoided * DIESEL_KG_PER_L / 1000
    return {
        "co2_t_per_year": round(co2_y, 1), "co2_t_10y": round(co2_y * 10),
        "diesel_today_l": round(diesel_today), "diesel_avoided_l": round(diesel_avoided), "diesel_with_plan_l": round(max(0.0, diesel_today - diesel_avoided)),
        "scope1_today_t": round(s1_today, 1), "scope1_with_plan_t": round(max(0.0, s1_today - s1_avoided), 1),
        "scope2_avoided_t": round(co2_y - s1_avoided, 1),   # negative when more grid power is bought to charge the storage
        "renewable_share_pct": rc_esg.get("renewable_share_pct", inv.get("renewable_share_pct", rec_sim.get("renewable_share_pct", 0))),
        "critical_served_pct": rc_esg.get("critical_served_pct", inv.get("critical_served_pct", rec_sim.get("critical_served_pct", 0))),
        "grid_kg_co2_per_kwh": asm.get("grid_kg_co2_per_kwh"),
        "lines": rc_esg.get("report_lines") or [],
        "credits_note": rc_esg.get("credits_note") or ("Avoided emissions become carbon credits only after a registered methodology, third-party verification and "
                                                       "issuance; the tonnes here are the engine's estimate, not issued credits."),
    }


@router.post("/report/esg", response_class=HTMLResponse, summary="Downloadable ESG report (forecast before purchase) for the selected site")
async def esg_report(payload: dict = Body(..., description="{assessment, carbon_price_usd_per_t?}")):
    a = payload.get("assessment") or payload
    price = payload.get("carbon_price_usd_per_t")
    try:
        price = float(price) if price not in (None, "") else None
    except (TypeError, ValueError):
        price = None
    option_id = payload.get("option_id")
    lens = {"sun": "Sun", "wind": "Wind", "water": "Water"}.get(str(payload.get("lens") or "").lower())
    f = esg_figures(a, option_id)
    loc, site, load = a.get("location", {}), a.get("site", {}), a.get("load", {})
    rec, is_rec = pick_option(a, option_id)
    rc = (a.get("relocatable_case") or {}) if is_rec else {}
    fac = a.get("inputs", {}).get("facility", {})
    name = fac.get("name") or rc.get("facility") or a.get("inputs", {}).get("facility_label") or "Facility"
    where = ", ".join(x for x in (loc.get("name"), loc.get("state"), loc.get("country")) if x)
    grid = site.get("grid", {})
    n = lambda v, d=0: f"{float(v or 0):,.{d}f}"   # noqa: E731

    lines = f["lines"] or [
        f"Environment: {n(f['co2_t_per_year'])} t CO₂ avoided a year, {n(f['diesel_avoided_l'])} L of diesel not burnt, "
        f"{n(f['renewable_share_pct'])} % of the energy from on-site renewables on the design day",
        f"Social: {n(load.get('critical_peak_kw'))} kW of life-critical load (theatres, ICU, labs, cold chain) kept on through the design outage; "
        f"{n(f['critical_served_pct'])} % of the critical load served in the simulation",
        "Governance: sizing from open data anyone can re-run; metered output and an uptime guarantee in the supply contract; "
        "figures to be confirmed by a load audit and verified before any claim is published",
    ]
    esg_rows = "".join(f"<li><b>{_esc(l.split(':', 1)[0])}</b>{_esc(':' + l.split(':', 1)[1]) if ':' in l else ''}</li>" for l in lines)
    comp = rec.get("components", {})
    sys_rows = []
    if comp.get("pv"):
        sys_rows.append(("Solar PV", f"{n(comp['pv'].get('kwp'))} kWp"))
    if comp.get("wind") and comp["wind"].get("kw"):
        sys_rows.append(("Wind", f"{n(comp['wind']['kw'])} kW"))
    if comp.get("backup_device"):
        b = comp["backup_device"]
        sys_rows.append((f"Storage ({str(b.get('chemistry', '')).replace('_', '-')})", f"{n(b.get('energy_kwh'))} kWh · {b.get('autonomy_h')} h"))
    if comp.get("hydrogen"):
        sys_rows.append(("Hydrogen", f"{n(comp['hydrogen'].get('h2_kg'))} kg H₂"))
    if comp.get("ups"):
        sys_rows.append(("UPS on critical circuits", f"{comp['ups'].get('kva')} kVA · 0 ms"))
    if comp.get("generator"):
        sys_rows.append(("Generator (last tier)", f"{n(comp['generator'].get('kva'))} kVA"))
    sys_html = "".join(f"<tr><td>{_esc(k)}</td><td><b>{_esc(v)}</b></td></tr>" for k, v in sys_rows)
    aaa = rc.get("three_as") or {}
    aaa_html = "".join(f"<div class='a'><small>{_esc(k.title())}</small><b>{_esc(v.get('headline', ''))}</b><ul>{''.join(f'<li>{_esc(x)}</li>' for x in v.get('facts', []))}</ul></div>"
                       for k, v in aaa.items() if isinstance(v, dict))
    two = rc.get("two_sites")
    move_html = (f"<p>The system is planned to move with the hospital to the new site {n(two['distance_km'], 1)} km away; "
                 f"{_esc(rc.get('move_plan', {}).get('reuse_pct', '—'))} % of the investment is reused there, so these savings continue after the move.</p>") if two else ""
    credit = (f"<p class='big'>{n(f['co2_t_10y'])} t over 10 years × US$ {n(price, 2)} per tonne = <b>US$ {n(f['co2_t_10y'] * price)}</b></p>" if price and price > 0
              else f"<p class='big'>{n(f['co2_t_10y'])} t CO₂ over 10 years · enter your buyer's price per tonne in the app to value them</p>")
    gf = f["grid_kg_co2_per_kwh"]

    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ESG report · {_esc(name)}</title>
<style>
 :root{{--ink:#0B1A2E;--mut:#5B6B85;--line:#D9E0EA;--gold:#D4A056;--green:#1F8F55;--soft:#F3F6FB}}
 *{{box-sizing:border-box}} body{{font-family:'Segoe UI',system-ui,sans-serif;color:var(--ink);margin:0;background:#fff;line-height:1.45}}
 .page{{max-width:960px;margin:0 auto;padding:36px 40px}}
 .top{{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:3px solid var(--gold);padding-bottom:14px}}
 .kick{{letter-spacing:.18em;font-size:11px;font-weight:700;color:#C8323C;text-transform:uppercase}}
 h1{{font-size:28px;margin:4px 0 2px}} h2{{font-size:15px;letter-spacing:.12em;text-transform:uppercase;margin:28px 0 8px;color:var(--ink)}}
 .sub{{color:var(--mut);font-size:13px}} .brand{{text-align:right;font-size:12px;color:var(--mut)}} .brand b{{display:block;color:var(--ink);font-size:15px}}
 .kpis{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:18px}}
 .kpi{{border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--soft)}} .kpi b{{font-size:22px;display:block}} .kpi span{{font-size:12px;color:var(--mut)}}
 .kpi.g b{{color:var(--green)}}
 table{{border-collapse:collapse;width:100%;font-size:13px}} td,th{{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left}}
 th{{background:var(--ink);color:#fff;font-size:11px;letter-spacing:.1em;text-transform:uppercase}} td.n{{text-align:right;font-variant-numeric:tabular-nums}}
 tr.tot td{{font-weight:700;background:var(--soft)}}
 ul.esg{{list-style:none;padding:0;margin:0}} ul.esg li{{padding:9px 12px;border-left:4px solid var(--green);background:var(--soft);margin-bottom:6px;font-size:13.5px}}
 ul.esg li b{{color:var(--green)}}
 .aaa{{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}} .a{{border:1px solid var(--line);border-radius:10px;padding:12px}}
 .a small{{color:#C8323C;letter-spacing:.14em;text-transform:uppercase;font-weight:700;font-size:10.5px}} .a b{{display:block;margin:4px 0;font-size:13.5px}}
 .a ul{{margin:0;padding-left:16px;font-size:12px;color:var(--mut)}}
 p{{font-size:13.5px}} .big{{font-size:15px}} .note{{font-size:12px;color:var(--mut)}}
 .cols{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}
 .foot{{margin-top:30px;border-top:1px solid var(--line);padding-top:10px;font-size:11px;color:var(--mut)}}
 .bar{{position:sticky;top:0;background:var(--ink);color:#fff;padding:10px 40px;display:flex;justify-content:space-between;align-items:center;font-size:13px}}
 .bar button{{background:var(--gold);border:0;color:var(--ink);font-weight:700;padding:8px 14px;border-radius:6px;cursor:pointer}}
 @media print{{.bar{{display:none}} .page{{padding:0 6mm}} h2{{break-after:avoid}} .kpi,.a,tr{{break-inside:avoid}}}}
 @media (max-width:700px){{.kpis,.aaa,.cols{{grid-template-columns:1fr}} .page{{padding:20px 16px}}}}
</style></head><body>
<div class="bar"><span>GridRescue AI · ESG report for {_esc(name)}</span><button onclick="window.print()">Save as PDF / print</button></div>
<div class="page">
<div class="top"><div><div class="kick">ESG report · forecast before purchase</div><h1>{_esc(name)}</h1>
<div class="sub">{_esc(where)} · {loc.get('lat')}°, {loc.get('lng')}° · {_esc(a.get('inputs', {}).get('facility_label', ''))}{f' · {lens} lens' if lens else ''}</div></div>
<div class="brand"><b>GridRescue AI</b>Secure AI Grid<br>engine {_esc(a.get('engine', {}).get('version', ''))} · {_esc(a.get('engine', {}).get('mode', ''))} mode</div></div>

<div class="kpis">
 <div class="kpi g"><b>{n(f['co2_t_per_year'])} t</b><span>CO₂ avoided a year</span></div>
 <div class="kpi g"><b>{n(f['diesel_avoided_l'])} L</b><span>diesel not burnt a year</span></div>
 <div class="kpi"><b>{n(f['renewable_share_pct'])} %</b><span>energy from on-site renewables (design day)</span></div>
 <div class="kpi"><b>{n(f['critical_served_pct'])} %</b><span>critical load served in the outage simulation</span></div>
</div>

<h2>Emissions by scope · GHG Protocol</h2>
<table><tr><th>Scope</th><th>Source</th><th>Today</th><th>With the plan</th><th>Avoided a year</th></tr>
<tr><td>Scope 1</td><td>Diesel burnt on site ({n(f['diesel_today_l'])} → {n(f['diesel_with_plan_l'])} L a year)</td><td class="n">{n(f['scope1_today_t'], 1)} t</td><td class="n">{n(f['scope1_with_plan_t'], 1)} t</td><td class="n">{n(f['scope1_today_t'] - f['scope1_with_plan_t'], 1)} t</td></tr>
<tr><td>Scope 2</td><td>Grid electricity bought while the grid is on{f' ({gf} kg CO₂/kWh)' if gf else ''}{' — more is bought to charge the storage for the night, so it is netted off' if f['scope2_avoided_t'] < 0 else ' — solar displaces it'}</td><td class="n">—</td><td class="n">—</td><td class="n">{n(f['scope2_avoided_t'], 1)} t</td></tr>
<tr class="tot"><td colspan="4">Total avoided · a year / over 10 years</td><td class="n">{n(f['co2_t_per_year'], 1)} t / {n(f['co2_t_10y'])} t</td></tr></table>
<p class="note">Diesel at {DIESEL_KG_PER_L} kg CO₂ per litre (IPCC default); grid electricity at the national grid emission factor, counted as the change in grid electricity bought while the grid is on (solar used during outages is counted once, as diesel not burnt). Scope 3 is not estimated.</p>

<h2>Report lines · Environment · Social · Governance</h2>
<ul class="esg">{esg_rows}</ul>

{'<h2>Access · Affordability · Availability</h2><div class="aaa">' + aaa_html + '</div>' if aaa_html else ''}

<div class="cols"><div>
<h2>The system behind the numbers</h2>
<p class="sub">{_esc(rec.get('name', ''))}{f' · the best {lens.lower()}-based design for this site' if lens and not is_rec else (f' · {lens} lens' if lens else '')}</p>
<table>{sys_html}</table>
</div><div>
<h2>The site</h2>
<table>
<tr><td>Grid</td><td><b>Class {_esc(grid.get('class', '—'))} · about {_esc(grid.get('supply_hours', '—'))} h of supply a day</b></td></tr>
<tr><td>Sun</td><td><b>{_esc(site.get('solar', {}).get('annual_psh', '—'))} peak-sun hours a day</b></td></tr>
<tr><td>Protected load</td><td><b>{n(load.get('protected_peak_kw'))} kW peak · {n(load.get('critical_peak_kw'))} kW critical</b></td></tr>
<tr><td>Distribution / state</td><td><b>{_esc(grid.get('disco') or '—')} / {_esc(grid.get('state') or '—')}</b></td></tr>
</table>
{move_html}
</div></div>

<h2>Carbon credits · potential, not issued</h2>
{credit}
<p class="note">{_esc(f['credits_note'])}</p>

<h2>Method</h2>
<p class="note">The GridRescue engine simulates the recommended system hour by hour at this location (sun, wind and water from NASA POWER, PVGIS and
Open-Meteo; grid from OpenStreetMap and the reported supply hours) and compares it with today's diesel use during grid outages. The avoided
emissions are the difference. This is a pre-feasibility forecast (±30 %) to support a decision before purchase: confirm it with a load audit and
metered data, and have it verified before it is published as an emissions claim.</p>
<div class="foot">GridRescue AI · Secure AI Grid · ESG forecast for {_esc(name)} · data: NASA POWER, PVGIS-SARAH2, Open-Meteo (ERA5), OpenStreetMap,
World Bank; emission factors: IPCC (diesel), national grid factor (electricity) · not an audited statement.</div>
</div></body></html>"""
    return HTMLResponse(doc)
