"""Checks every GridRescue API route and every open-data source behind it, at one site, and prints a table.

Usage (backend running):  python backend/scripts/api_health.py [http://127.0.0.1:8000] [lat] [lng]
Defaults to the Brief 12 site (National Orthopaedic Hospital, Enugu). "source" says which provider answered, so a
fallback (e.g. PVGIS → NASA POWER → model) is visible rather than hidden. Exit code 1 if any route fails."""
import json, sys, time, urllib.request, urllib.error

API = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8000'
LAT = float(sys.argv[2]) if len(sys.argv) > 2 else 6.4692
LNG = float(sys.argv[3]) if len(sys.argv) > 3 else 7.5450
q = f'lat={LAT}&lng={LNG}'


def call(method, path, body=None, timeout=240):
    t = time.time()
    req = urllib.request.Request(API + path, json.dumps(body).encode() if body is not None else None, {'Content-Type': 'application/json'}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read(); ct = r.headers.get('content-type', '')
            return r.status, (json.loads(raw) if 'json' in ct else raw.decode('utf8', 'ignore')), time.time() - t
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf8', 'ignore')[:200], time.time() - t
    except Exception as e:
        return 0, str(e)[:200], time.time() - t


def src(d, *keys):
    """The provider that answered, wherever the route reports it."""
    if not isinstance(d, dict): return ''
    for k in keys:
        v = d
        for part in k.split('.'):
            v = v.get(part) if isinstance(v, dict) else None
        if v: return str(v)[:60]
    return ''


case = call('GET', '/api/cases/noh-enugu')[1]
ROUTES = [
    ('GET', '/health', None, ('status',)),
    ('GET', '/api/cases', None, ()),
    ('GET', '/api/cases/noh-enugu', None, ()),
    ('GET', '/api/cases/noh-enugu/consumption', None, ('source',)),
    ('GET', f'/api/relocation/suggest?{q}', None, ('source',)),
    ('GET', f'/api/tariff?{q}', None, ('source', 'label')),
    ('GET', f'/api/location?{q}', None, ('source',)),
    ('GET', '/api/geocode?q=Enugu', None, ('source',)),
    ('GET', '/api/states', None, ()),
    ('GET', f'/api/sun?{q}', None, ('source', 'provider')),
    ('GET', f'/api/wind?{q}', None, ('rose_source', 'sources')),
    ('GET', f'/api/weather?{q}', None, ('source', 'provider')),
    ('GET', f'/api/climate?{q}', None, ('source', 'sources')),
    ('GET', f'/api/hourly?{q}&month=1', None, ('source', 'provider')),
    ('GET', f'/api/solar-check?{q}', None, ('agreement',)),
    ('GET', f'/api/water?{q}', None, ('source', 'sources')),
    ('GET', f'/api/grid?{q}', None, ('source', 'power.source')),
    ('GET', f'/api/grid/scan?{q}&supply_hours=6', None, ('source',)),
    ('GET', f'/api/facilities?{q}', None, ('source', 'sources')),
    ('GET', '/api/country/NG', None, ('source',)),
    ('GET', '/api/facility-types', None, ()),
    ('GET', f'/api/site?{q}', None, ('source', 'sources')),
    ('GET', '/api/health-data/providers', None, ()),
    ('GET', '/api/hospitals/featured', None, ()),
    ('GET', '/api/technologies', None, ()),
    ('GET', '/api/ml/model', None, ('algorithm', 'model')),
    ('POST', '/api/load-model', (case or {}).get('facility'), ()),
    ('GET', '/api/sources', None, ()),
    ('GET', f'/api/solar-atlas?{q}', None, ('source',)),
    ('GET', f'/api/energydata?{q}', None, ('source',)),
    ('GET', f'/api/grid/feeder?{q}&kw=641&kw_connected=1550', None, ('substation.voltage_kv',)),
    ('GET', f'/api/grid/geojson?{q}', None, ('type',)),
]
if isinstance(case, dict):
    h = case['hospital']
    ROUTES.append(('POST', '/api/assess', {'location': {'lat': h['lat'], 'lng': h['lng']}, 'facility': case['facility'], 'options': case['options']}, ('recommended.id',)))

fail = 0; assessed = None
print(f'{"route":58} {"status":>6} {"secs":>6}  answered by')
for method, path, body, keys in ROUTES:
    st, d, dt = call(method, path, body)
    ok = st == 200
    fail += not ok
    if path == '/api/assess' and ok: assessed = d
    print(f'{method + " " + path.split("?")[0]:58} {st:>6} {dt:6.1f}  {src(d, *keys) if ok else str(d)[:80]}')
if assessed:
    st, d, dt = call('POST', '/api/report', assessed)
    fail += st != 200
    print(f'{"POST /api/report":58} {st:>6} {dt:6.1f}  {"HTML " + str(len(d)) + " chars" if st == 200 else d}')
    rc = assessed.get('relocatable_case') or {}
    print('\nBrief 12 parts present:', ', '.join(k for k in ('starter_answers', 'critical_loads', 'phases', 'relocatable_design', 'move_plan', 'ownership', 'cost_model', 'funders', 'esg', 'adapt', 'three_as') if rc.get(k)))
print(f'\n{len(ROUTES) + (1 if assessed else 0) - fail} of {len(ROUTES) + (1 if assessed else 0)} routes OK')
sys.exit(1 if fail else 0)
