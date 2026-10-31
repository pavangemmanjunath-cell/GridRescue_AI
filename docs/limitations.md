# Limitations

## Scientific Limitations

- One typical 24-hour design day represents the year; outages longer than a day are approximated by the 24-hour national-collapse case.
- Sizing uses rules (energy for the backup hours, PV to cover 125 % of the protected daily energy) rather than a full optimisation.
- Results are pre-feasibility estimates of about ±30 % on cost; the band is assumed, not derived from validation.
- No comparison with a full-year tool or with measured data has been made yet (see [novelty.md](novelty.md#evidence-still-required)).

## Data Limitations

- Loads come from bed-based or type-based benchmarks until a facility's metered profile is supplied.
- In the worked example, the land area (20,000 m²), the generator size (1,000 kVA) and the diesel bill are assumed and flagged as "to confirm".
- Open-data coverage varies: OpenStreetMap power infrastructure is incomplete in places; state reliability classes are defaults.
- Tariffs and diesel prices change over time; each value carries its source.

## Model Limitations

- The classifier agrees with the engine on 80.4 % of held-out synthetic sites; it has not been validated against real installations.
- Wind-only, flow and hydrogen designs are rare in the training labels and are effectively never picked by the classifier. The simulation still evaluates them.
- The classifier's probabilities are vote shares, not calibrated probabilities.
- Ask GridRescue answers by retrieval only; it cannot reason beyond the passages it finds.

## Generalization Limitations

- Sampling ranges and defaults are weighted toward Nigeria and sub-Saharan Africa.
- Tariff tables exist for Nigeria, Kenya, South Africa and Ghana only.
- Offline mode relies on a Nigeria OpenStreetMap snapshot; elsewhere it uses modelled values.

## Computational Limitations

- An assessment takes a few seconds; retraining the classifier takes about ten minutes on a laptop.
- The 3D pages need WebGL; on machines without a GPU they render slowly in software.

## Security / Privacy Considerations

- No authentication, roles, rate limiting or audit log (see [SECURITY.md](../SECURITY.md)).
- The browser contacts tile.openstreetmap.org and Google Fonts; users in jurisdictions with strict privacy rules may want to self-host fonts and tiles.
- No personal data is collected.

## Deployment Limitations

- Development servers only; no container or production configuration is provided.
- Public OpenStreetMap tiles are not meant for heavy use; a production deployment needs its own tile provider.
- `start.sh` is smoke-tested on Linux in CI but has not been tested by hand on macOS.

## Licensing Notes

- `backend/app/data/osm_ng.json` is under the ODbL, not Apache-2.0 (see [NOTICE](../NOTICE)).
- The frontend depends on react-leaflet, published under the Hippocratic License 2.1, which adds conditions on use. Anyone redistributing a built frontend should review it.

## Areas Requiring Further Validation

- Sizing and costs against local engineering quotes.
- Emission factors against national inventories.
- The worked example against the hospital's own load and generator logs.
- The classifier against engineers' decisions on real sites.
