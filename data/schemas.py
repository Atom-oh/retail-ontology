"""
Pydantic schemas for the ontology demo data model (spec § 8).

These types serve as the single source of truth for JSON serialization,
LLM tool-use input schemas, and Neptune loading (Phase 3).
"""
from __future__ import annotations

from datetime import date
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


Domain = Literal["grocery", "beauty"]
Sentiment = Literal["positive", "neutral", "negative"]
ConcernDomain = Literal["skin", "diet", "lifestyle"]
TrendType = Literal["seasonal", "kbeauty", "diet", "functional", "korea"]
Gender = Literal["F", "M", "Other"]
ChannelType = Literal["편의점", "마트", "드럭스토어", "온라인"]


class Manufacturer(BaseModel):
    mfr_id: str
    name_ko: str
    name_en: Optional[str] = None
    country: str = "KR"
    domains: List[Domain]


class Brand(BaseModel):
    brand_id: str
    name_ko: str
    name_en: Optional[str] = None
    manufacturer_id: str
    domain: Domain
    positioning_ko: Optional[str] = None


class Category(BaseModel):
    gs1_brick_code: str
    gs1_brick_name_en: str
    kfda_category_path: str
    retail_category_ko: str
    synonyms_ko: List[str] = Field(default_factory=list)
    domain: str


class Ingredient(BaseModel):
    ingredient_id: str
    name_en: str
    name_ko: str
    synonyms_ko: List[str] = Field(default_factory=list)
    function_ko: Optional[str] = None
    concerns_ko: List[str] = Field(default_factory=list)
    regulatory_class: Optional[str] = None
    standard: Literal["INCI", "FoodOn", "Custom"]


class Nutrient(BaseModel):
    nutrient_id: str
    name_ko: str
    name_en: str
    unit: str
    daily_value: Optional[float] = None


class Concern(BaseModel):
    concern_id: str
    name_ko: str
    name_en: str
    domain: ConcernDomain
    description_ko: Optional[str] = None
    prefers_ingredient_ids: List[str] = Field(default_factory=list)
    avoids_ingredient_ids: List[str] = Field(default_factory=list)


class Persona(BaseModel):
    persona_id: str
    label_ko: str
    age: int
    gender: Gender
    life_stage_ko: Optional[str] = None
    occupation_ko: Optional[str] = None
    concern_ids: List[str] = Field(default_factory=list)
    preferred_ingredient_ids: List[str] = Field(default_factory=list)
    avoided_ingredient_ids: List[str] = Field(default_factory=list)
    favorite_brick_codes: List[str] = Field(default_factory=list)
    narrative_ko: str
    is_wow: bool = False


class ProductIngredient(BaseModel):
    ingredient_id: str
    amount_note_ko: Optional[str] = None


class ProductNutrient(BaseModel):
    nutrient_id: str
    value: float
    per_100g_or_ml: bool = True


class Product(BaseModel):
    sku_id: str
    name_ko: str
    name_en: Optional[str] = None
    domain: Domain
    gs1_brick_code: str
    brand_id: str
    volume: Optional[float] = None
    unit: Optional[Literal["ml", "g", "ea"]] = None
    price_krw: int
    ingredients: List[ProductIngredient] = Field(default_factory=list)
    nutrients: List[ProductNutrient] = Field(default_factory=list)
    claims_ko: List[str] = Field(default_factory=list)
    target_concern_ids: List[str] = Field(default_factory=list)
    description_ko: str
    is_wow: bool = False


class Review(BaseModel):
    review_id: str
    sku_id: str
    persona_id: str
    sentiment: Sentiment
    rating: int = Field(ge=1, le=5)
    title_ko: Optional[str] = None
    body_ko: str
    helpful_count: int = 0
    review_date: date


class Trend(BaseModel):
    trend_id: str
    name_ko: str
    name_en: Optional[str] = None
    type: TrendType
    description_ko: str
    involves_ingredient_ids: List[str] = Field(default_factory=list)
    involves_brick_codes: List[str] = Field(default_factory=list)
    emerged_period: Optional[str] = None


class Promotion(BaseModel):
    promotion_id: str
    name_ko: str
    discount_pct: int
    period_start: date
    period_end: date
    applies_to_sku_ids: List[str] = Field(default_factory=list)
    applies_to_brick_codes: List[str] = Field(default_factory=list)
    channel_ids: List[str] = Field(default_factory=list)


class Channel(BaseModel):
    channel_id: str
    name_ko: str
    type: ChannelType
