# Examples

## quickstart.py — assess a site

Runs the planning engine in-process: no server, browser or API key. By default it reads open data like the app does; `--offline` uses only the bundled snapshots and modelled hourly weather. It takes a few seconds.

```bash
# from the repository root, with the backend dependencies installed (see README › Run it)
python examples/quickstart.py                                                    # the Enugu worked example
python examples/quickstart.py --lat 12.0022 --lng 8.5920 --type hospital_general --beds 150   # any site
```

Options: `--offline`, `--lat`, `--lng`, `--type` (for example `hospital_general`, `clinic_phc`, `telecom_tower`, `school`), `--beds`, `--backup-hours`, `--generator-kva`.

Expected output for the worked example, with internet access:

```
Site            6.4684, 7.5256 · grid about 6 h a day
Recommended     UPS + Solar PV + Li-ion backup device + Existing diesel backup
  Solar PV          1,670 kWp
  Storage           5,020 kWh
  UPS                 500 kVA
  Generator         1,000 kVA
Critical load   100 % served through the design outage (hourly simulation)
Stress tests    4/4 outage scenarios keep critical and essential load fully served.
Diesel avoided  866,678 L a year
CO2 avoided     2,246 t a year net (Scope 1 2,323 t, Scope 2 -77 t)
ML first pick   Predicts 'Solar PV + Li-ion backup device (+ UPS)' with 76 % of the forest's vote; ...
Verified        override: the hourly simulation decides the recommendation
```

"override" means the hourly simulation preferred a design other than the classifier's first pick; here it keeps the existing generator as the last resort. With `--offline` the design is the same and the diesel and CO₂ lines read 845,654 L and 2,344 t, because the hourly weather is modelled. The numbers are pre-feasibility estimates (about ±30 %).

## More

- The full web application: `START.bat` (Windows) or `./start.sh` (Linux/macOS), then http://localhost:5173.
- The REST API: start the backend and open http://localhost:8000/docs.
