# External health-facility datasets (optional)

Drop CSV exports here and the backend merges them into `/api/facilities` automatically (restart not required — files are read lazily once).

| File name | Provider | Where to download |
|---|---|---|
| `ssa_health_facilities.csv` | WHO / KEMRI-Wellcome Trust — public health facilities in sub-Saharan Africa (Maina et al. 2019) | https://data.humdata.org/dataset/health-facilities-in-sub-saharan-africa |
| `grid3_nga_health_facilities.csv` | GRID3 Nigeria Health Facilities v2.0 | https://data.grid3.org/maps/GRID3::grid3-nga-health-facilities-v2-0 |
| `nhfr_facilities.csv` | Nigeria Health Facility Registry (FMoH / NCDC data portal) | https://hfr.fmohconnect.gov.ng/ · https://dataportal.ncdc.gov.ng/dataset/national-health-facility-registry |
| `hotosm_nga_health_facilities.csv` | HOT OSM Nigeria health facilities export | https://data.humdata.org/dataset/hotosm_nga_health_facilities |

Columns are auto-detected (latitude/longitude/name/type). healthsites.io is used live when `GR_HEALTHSITES_API_KEY` is set (free key: https://healthsites.io/).
