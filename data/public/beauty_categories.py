"""
Beauty product categories (cosmetics taxonomy).

GS1 GPC bricks cover food/grocery; cosmetics use a separate global taxonomy
(GS1 has bricks for personal care but the Phase 0 mapping CSV is grocery-only).
For the demo, we use a curated 12-category set that maps to 식약처 화장품
대분류와 한국 리테일(올리브영/CJ몰) 카테고리 트리.

Codes use a `bty_*` namespace (not GS1 8-digit) and are wired into the same
Category schema for uniformity.
"""
from __future__ import annotations

from typing import List

from data.schemas import Category

# (code, name_en, kfda_path, retail_label, synonyms_ko)
_BEAUTY_CATEGORIES = [
    ("bty_toner",   "Toner / Skin",          "화장품 > 기초 > 토너",       "토너/스킨",      ["토너", "스킨", "기초화장품"]),
    ("bty_serum",   "Essence / Serum / Ampoule", "화장품 > 기초 > 세럼",   "에센스/세럼",    ["에센스", "세럼", "앰플"]),
    ("bty_cream",   "Moisturizer",           "화장품 > 기초 > 크림",       "수분/영양크림",  ["크림", "수분크림", "영양크림", "보습크림"]),
    ("bty_cleanser","Facial Cleanser",       "화장품 > 클렌저 > 폼/젤",    "폼/젤 클렌저",    ["클렌징폼", "폼클렌저", "젤클렌저", "세안제"]),
    ("bty_sunscreen","Sunscreen / SPF",      "화장품 > 자외선차단",        "선크림",         ["선크림", "선블록", "자외선차단제", "썬크림", "무기자차", "유기자차"]),
    ("bty_mask",    "Sheet Mask",            "화장품 > 마스크팩",          "마스크팩",       ["마스크팩", "시트팩", "팩", "수분팩"]),
    ("bty_eye",     "Eye Cream",             "화장품 > 부분케어 > 아이",   "아이크림",       ["아이크림", "눈가크림"]),
    ("bty_lip",     "Lip Care",              "화장품 > 부분케어 > 립",     "립케어",         ["립밤", "립케어", "립트리트먼트"]),
    ("bty_body",    "Body Lotion / Cream",   "화장품 > 바디 > 로션",       "바디로션",       ["바디로션", "바디크림", "보디로션"]),
    ("bty_cleansing_oil", "Cleansing Oil / Balm", "화장품 > 클렌저 > 오일", "클렌징 오일/밤", ["클렌징오일", "클렌징밤", "오일클렌저"]),
    ("bty_cica",    "Cica Soothing Line",    "화장품 > 진정라인 > 시카",   "시카진정",       ["시카크림", "병풀크림", "민감성진정"]),
    ("bty_makeup",  "Makeup (Lip/Eye/Cheek)","화장품 > 색조",              "색조 메이크업",  ["립스틱", "쿠션", "아이섀도", "틴트", "블러셔"]),
]


def load_beauty_categories() -> List[Category]:
    return [
        Category(
            gs1_brick_code=code,
            gs1_brick_name_en=name_en,
            kfda_category_path=path,
            retail_category_ko=ret,
            synonyms_ko=syn,
            domain="beauty",
        )
        for code, name_en, path, ret, syn in _BEAUTY_CATEGORIES
    ]


if __name__ == "__main__":
    cats = load_beauty_categories()
    print(f"Loaded {len(cats)} beauty categories")
    for c in cats:
        print(f"  {c.gs1_brick_code:18} {c.retail_category_ko}")
