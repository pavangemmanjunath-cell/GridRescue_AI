/* Types for the GridRescue AI backend contract. Deeply nested engine payloads are typed loosely on purpose. */

export interface LocationInfo {
  name: string; state?: string | null; state_iso?: string | null; country: string; country_code: string; timezone: string;
  display_name?: string | null; lat: number; lng: number; elevation_m: number; in_africa: boolean; in_nigeria: boolean;
  grid_class?: string | null; grid_class_meta?: { label: string; supply_hours: number; outage_risk: string; score: number } | null;
  disco?: string | null; zone?: string | null; source: string;
}

export interface SunData { annual_ghi_kwh_m2: number; annual_psh: number; monthly_psh: number[]; monthly_ghi_kwh_m2: number[]; monthly_temp_c: number[]; source: string; sources: string[]; live: boolean }
export interface WindSector { direction: string; frequency_pct: number; avg_speed_ms: number }
export interface WindData { annual_avg_ms: number; monthly_avg_ms: number[]; monthly_avg_10m_ms: number[]; wind_rose: WindSector[]; rose_source: string; rose_year?: number; sources: string[] }
export interface WeatherData {
  current: { temperature_c: number; feels_like_c: number; humidity_pct: number; wind_speed_ms: number; wind_direction_deg: number; cloud_cover_pct: number; uv_index: number; weather_code: number; time: string; precipitation_mm: number } | null;
  forecast: { date: string; weather_code: number; temp_max_c: number; temp_min_c: number; precipitation_mm: number; sunshine_hours: number; radiation_kwh_m2: number; wind_max_ms: number }[];
  timezone: string; source: string;
}
export interface WaterFeature { id: string; name: string; kind: string; distance_km: number; bearing: string; intermittent: boolean; geometry: [number, number][] | null; lat: number | null; lng: number | null; mean_m3s?: number }
export interface WaterData {
  waterways: { radius_km: number; source: string; count: number; rivers: number; streams: number; lakes: number; dams: number; nearest: WaterFeature | null; nearest_river: WaterFeature | null; features: WaterFeature[] };
  discharge: { today_m3s: number | null; mean_30d_m3s: number | null; max_30d_m3s: number | null; min_30d_m3s: number | null; series: { date: string; m3s: number | null }[]; source: string };
  terrain: { center_m: number; min_m: number; max_m: number; head_up_m: number; head_down_m: number; relief_m: number; radius_km: number; source: string };
  monthly_precip_mm_day: number[];
  scores: { water_availability: number; micro_hydro: number; pumped_hydro: number; hydrogen_water: number; nearest_distance_km: number | null; discharge_class: string; head_m: number; rain_mm_yr: number };
}
export interface GridData {
  power: { radius_km: number; source: string; substations: any[]; plants: any[]; lines: { id: string; name?: string; voltage_kv: number; geometry: [number, number][]; distance_km: number }[]; summary: any };
  country: any;
  reliability: { grid_class: string; class_label: string; outage_risk: string; expected_supply_hours_per_day: number; expected_outage_hours_per_day: number; reliability_score: number; infrastructure_score: number; state?: string | null; disco?: string | null; override: boolean; basis: string; reported_supply_hours?: number | null };
}
export interface Facility { id: string; name: string; type: string; tier: string; lat: number; lng: number; distance_km: number; bearing: string; emergency: boolean; beds?: number | null; operator?: string | null; precision: string }
export interface FacilitiesData { radius_km: number; source: string; count: number; hospitals: number; clinics: number; nearest: Facility | null; facilities: Facility[] }
export interface HourlyProfile { ghi_w_m2: number[]; wind_ms: number[]; wind_10m_ms?: number[]; temp_c: number[]; source: string; year?: number }

export type FacilityType = 'hospital_tertiary' | 'hospital_general' | 'clinic_phc' | 'emergency_center' | 'telecom_tower' | 'water_treatment' | 'school' | 'cold_chain' | 'data_center' | 'custom'
export type Priority = 'balanced' | 'cheapest' | 'greenest' | 'most_reliable' | 'longest_backup'

export interface FacilityInput {
  type: FacilityType; name?: string; beds?: number | null; avg_load_kw?: number | null; critical_load_kw?: number | null; daily_kwh?: number | null;
  backup_hours: number; existing: { grid_connection: boolean; generator_kva: number; solar_kwp: number; ups_kva: number };
  roof_area_m2: number; land_area_m2: number; water_source: 'none' | 'borehole' | 'municipal' | 'river' | 'lake';
  budget_usd?: number | null; priority: Priority; allow_new_generator: boolean;
}
export interface SitePoint { lat: number; lng: number; label?: string | null }
export interface RelocationOptions {
  new_site?: SitePoint | null; move_year: number; horizon_years: number; theatre_suites: number; theatre_hours_per_day: number; theatre_days_per_week: number
  reported_diesel_ngn_per_month?: number | null
}
export interface AssessOptions {
  grid_class_override?: string | null; outage_start_hour: number; month: number; radius_km: number; charge_from_grid: boolean
  supply_hours_override?: number | null; diesel_price_usd_per_l?: number | null; grid_tariff_usd_per_kwh?: number | null; usd_to_ngn?: number | null
  relocation?: RelocationOptions | null
}

/** A ready-made hackathon case (Brief 12: National Orthopaedic Hospital, Enugu). */
export interface CaseData {
  id: string
  brief: { number: number; track: string; title: string; focus_region: string; persona: string; persona_note: string; framing: string; constraints: string[]; deliverables: { text: string; tab: string }[]; starter_questions: string[] }
  hospital: { name: string; short: string; address: string; postal: string; lat: number; lng: number; beds: number; connected_kw: number; grid_hours_per_day: number; grid_source: string; disco: string; services: string[]; move_in_years: number }
  new_site: SitePoint & { illustrative: boolean; note: string }
  facility: FacilityInput
  options: Omit<AssessOptions, 'radius_km' | 'charge_from_grid' | 'grid_class_override'> & { relocation: RelocationOptions }
  prices: { label: string; value: string; source: string }[]
  inputs_to_confirm: { label: string; value: string; why: string }[]
  references: { id: number; title: string; url?: string }[]
}
export interface SiteSuggestion { lat: number; lng: number; distance_km: number; direction: string; score: number; grid_score: number; move_score: number; label: string; reasons: string[]; rank?: number; nearest_substation_km: number | null }
export interface Suggestions { center: { lat: number; lng: number }; today: SiteSuggestion | null; candidates: SiteSuggestion[]; top: SiteSuggestion[]; radius_km: number; source: string; note: string }
export interface SolarCheck { rows: { id: string; source: string; value: number | null; unit: string; note: string; live: boolean }[]; yield_spread_pct: number | null; agreement: string | null }
export interface FeederRun { load: string; kv: number; distance_km: number; kw: number; conductor: string; solver: string; limits: string; ok: boolean; text: string; drop_pct?: number; loading_pct?: number; losses_kw?: number; voltage_pu?: number }
export interface FeederCheck { substation: { name: string | null; voltage_kv: number | null; distance_km: number; bearing: string } | null; checks: FeederRun[]; note: string }
export interface EnergyData { source: string; country: string; count: number; datasets: { title: string; publisher: string | null; url: string; formats: string[] }[]; error?: string }
export interface DataSource { group: string; name: string; use: string; status: string; route: string | null }

export interface SimRow {
  hour: number; load_kw: number; critical_kw: number; essential_kw: number; non_essential_kw: number; pv_kw: number; wind_kw: number; grid_available: number; outage_event: number;
  grid_import_kw: number; backup_charge_kw: number; backup_discharge_kw: number; soc_pct: number; generator_kw: number; fuel_cell_kw: number; pumped_hydro_kw: number; curtailed_kw: number; unserved_kw: number; unserved_critical_kw: number;
}
export interface Architecture {
  id: string; name: string; short: string; parts: string[]; color: string; score: number; suitability: string; capped: boolean; notes: string[];
  dimensions: Record<string, number>; autonomy_h: number; components: any; cost: any; lifecycle: any; simulation_summary: any; simulation_hourly: SimRow[];
  reasons: { kind: string; text: string }[]; rank?: number;
}
export interface Assessment {
  engine: { name: string; version: string; mode: string; disclaimer: string };
  location: LocationInfo; inputs: { facility: FacilityInput; options: AssessOptions; facility_label: string };
  climate: any; hourly_profile: HourlyProfile; water: any; grid: any; site: any; load: any;
  recommended: Architecture; ranked: Architecture[]; recommended_stack: Architecture; investment_case?: any; agent?: any; relocatable_case?: any; resilience?: { curve: { hours: number; survival_pct: number }[]; starts_tested: number; method: string }; weights: Record<string, number>; dimension_labels: Record<string, string>; references: { id: string; title: string; url: string }[];
}
export interface Technology { id: string; name: string; category: string; group: string; duration_h: [number, number]; response: string; rte: number; life_years: number; cycle_life: number; capex_usd_per_kw: number; capex_usd_per_kwh: number; opex_pct: number; trl: number; complexity: number; footprint: string; site_needs: string; nigeria_note: string; evaluated: boolean }
