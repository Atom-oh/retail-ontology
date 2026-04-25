"""
Minimal FoodOn-aligned nutrient catalog (Korean 식약처 1일 기준치).

식약처 영양성분 1일 기준치 (식품등의 표시기준 별표). FoodOn provides the
ontological backbone, but we only carry a curated nutrient subset relevant
to demo SKUs (250 grocery items). Full FoodOn integration is a follow-up
card (spec § 15-A Real Data PoC).
"""
from __future__ import annotations

from typing import List, Optional, Tuple

from data.schemas import Nutrient

# (slug, name_ko, name_en, unit, daily_value)
_NUTRIENTS_RAW: List[Tuple[str, str, str, str, Optional[float]]] = [
    ("calorie", "칼로리", "Calorie", "kcal", 2000.0),
    ("carbohydrate", "탄수화물", "Carbohydrate", "g", 324.0),
    ("sugar", "당류", "Sugar", "g", 100.0),
    ("protein", "단백질", "Protein", "g", 55.0),
    ("fat", "지방", "Fat", "g", 54.0),
    ("saturated_fat", "포화지방", "Saturated Fat", "g", 15.0),
    ("trans_fat", "트랜스지방", "Trans Fat", "g", 0.0),
    ("cholesterol", "콜레스테롤", "Cholesterol", "mg", 300.0),
    ("dietary_fiber", "식이섬유", "Dietary Fiber", "g", 25.0),
    ("sodium", "나트륨", "Sodium", "mg", 2000.0),
    ("calcium", "칼슘", "Calcium", "mg", 700.0),
    ("iron", "철", "Iron", "mg", 12.0),
    ("vitamin_a", "비타민A", "Vitamin A", "μg RAE", 700.0),
    ("vitamin_c", "비타민C", "Vitamin C", "mg", 100.0),
    ("vitamin_d", "비타민D", "Vitamin D", "μg", 10.0),
    ("vitamin_e", "비타민E", "Vitamin E", "mg α-TE", 11.0),
    ("vitamin_b6", "비타민B6", "Vitamin B6", "mg", 1.5),
    ("vitamin_b12", "비타민B12", "Vitamin B12", "μg", 2.4),
    ("folate", "엽산", "Folate", "μg DFE", 400.0),
    ("niacin", "나이아신", "Niacin", "mg NE", 15.0),
    ("zinc", "아연", "Zinc", "mg", 8.5),
    ("magnesium", "마그네슘", "Magnesium", "mg", 315.0),
    ("potassium", "칼륨", "Potassium", "mg", 3500.0),
    ("phosphorus", "인", "Phosphorus", "mg", 700.0),
    ("caffeine", "카페인", "Caffeine", "mg", None),
    ("alcohol", "알코올", "Alcohol", "%", None),
    ("probiotic_cfu", "유산균 수", "Probiotic CFU", "CFU", None),
    ("omega_3", "오메가3", "Omega-3", "mg", 1100.0),
]


def load_nutrients() -> List[Nutrient]:
    return [
        Nutrient(
            nutrient_id=f"ntr:{slug}",
            name_ko=name_ko,
            name_en=name_en,
            unit=unit,
            daily_value=dv,
        )
        for slug, name_ko, name_en, unit, dv in _NUTRIENTS_RAW
    ]


if __name__ == "__main__":
    items = load_nutrients()
    print(f"Loaded {len(items)} nutrients")
    for n in items[:5]:
        print(f"  {n.nutrient_id:24} {n.name_ko:8} {n.unit:10} DV={n.daily_value}")
