"""Pydantic request/response models for the assessment API."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

FacilityType = Literal["hospital_tertiary", "hospital_general", "clinic_phc", "emergency_center", "telecom_tower",
                       "water_treatment", "school", "cold_chain", "data_center", "custom"]
Priority = Literal["balanced", "cheapest", "greenest", "most_reliable", "longest_backup"]
WaterSource = Literal["none", "borehole", "municipal", "river", "lake"]
GridClass = Literal["A", "B", "C", "D", "E"]


class ExistingAssets(BaseModel):
    grid_connection: bool = True
    generator_kva: float = Field(0, ge=0, le=20000)
    solar_kwp: float = Field(0, ge=0, le=50000)
    ups_kva: float = Field(0, ge=0, le=5000)


class FacilityInput(BaseModel):
    type: FacilityType = "hospital_general"
    name: Optional[str] = None
    beds: Optional[int] = Field(None, ge=0, le=5000)
    avg_load_kw: Optional[float] = Field(None, ge=0, le=100000)
    critical_load_kw: Optional[float] = Field(None, ge=0, le=100000)
    daily_kwh: Optional[float] = Field(None, ge=0, le=2400000)
    backup_hours: float = Field(12, ge=0.25, le=168)
    existing: ExistingAssets = ExistingAssets()
    roof_area_m2: float = Field(1500, ge=0, le=500000)
    land_area_m2: float = Field(0, ge=0, le=5000000)
    water_source: WaterSource = "borehole"
    budget_usd: Optional[float] = Field(None, ge=0)
    priority: Priority = "balanced"
    allow_new_generator: bool = True


class SitePoint(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    label: Optional[str] = None


class RelocationOptions(BaseModel):
    """Brief 12: a hospital that moves to a new building — where, when, and the facts only the hospital holds."""
    new_site: Optional[SitePoint] = None
    move_year: int = Field(5, ge=1, le=15)
    horizon_years: int = Field(10, ge=5, le=15)
    theatre_suites: int = Field(4, ge=0, le=40)
    theatre_hours_per_day: float = Field(10, ge=1, le=24)
    theatre_days_per_week: int = Field(6, ge=1, le=7)
    reported_diesel_ngn_per_month: Optional[float] = Field(None, ge=0)


class AssessOptions(BaseModel):
    grid_class_override: Optional[GridClass] = None
    supply_hours_override: Optional[float] = Field(None, ge=0, le=24)   # grid hours a day reported by the facility
    outage_start_hour: int = Field(18, ge=0, le=23)
    month: int = Field(2, ge=0, le=11)   # March by default (hot, pre-monsoon)
    radius_km: float = Field(30, ge=5, le=100)
    charge_from_grid: bool = True
    usd_to_ngn: Optional[float] = None
    diesel_price_usd_per_l: Optional[float] = None
    grid_tariff_usd_per_kwh: Optional[float] = None
    relocation: Optional[RelocationOptions] = None


class LocationInput(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class AssessRequest(BaseModel):
    location: LocationInput
    facility: FacilityInput = FacilityInput()
    options: AssessOptions = AssessOptions()
