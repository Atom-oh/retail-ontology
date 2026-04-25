"""
Deterministic generators (no LLM). Produces:
- 30 manufacturers
- 60 brands
- 25 concerns (with prefer/avoid ingredient links for the wow ones)
- 30 trends (with ingredient/category links for the wow ones)
- 4 channels (편의점/마트/드럭스토어/온라인)

Run:  python -m data.synthetic.deterministic
Outputs to data/output/{manufacturers,brands,concerns,trends,channels}.json
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import List

from data.schemas import (
    Brand,
    Channel,
    Concern,
    Manufacturer,
    Trend,
)

OUTPUT_DIR = Path(__file__).resolve().parents[1] / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------------
# Manufacturers (30) — 15 grocery / 10 beauty / 5 multi-domain or specialty
# --------------------------------------------------------------------------
_MANUFACTURERS = [
    ("mfr_001", "농심", "Nongshim", ["grocery"]),
    ("mfr_002", "오뚜기", "Ottogi", ["grocery"]),
    ("mfr_003", "CJ제일제당", "CJ CheilJedang", ["grocery"]),
    ("mfr_004", "빙그레", "Binggrae", ["grocery"]),
    ("mfr_005", "매일유업", "Maeil Dairies", ["grocery"]),
    ("mfr_006", "서울우유", "Seoul Milk", ["grocery"]),
    ("mfr_007", "동서식품", "Dongsuh Foods", ["grocery"]),
    ("mfr_008", "롯데제과", "Lotte Confectionery", ["grocery"]),
    ("mfr_009", "해태제과", "Haitai Confectionery", ["grocery"]),
    ("mfr_010", "풀무원", "Pulmuone", ["grocery"]),
    ("mfr_011", "한국야쿠르트", "HY (Korea Yakult)", ["grocery"]),
    ("mfr_012", "동원F&B", "Dongwon F&B", ["grocery"]),
    ("mfr_013", "SPC삼립", "SPC Samlip", ["grocery"]),
    ("mfr_014", "코카콜라음료", "Coca-Cola Beverage Korea", ["grocery"]),
    ("mfr_015", "롯데칠성음료", "Lotte Chilsung Beverage", ["grocery"]),
    ("mfr_016", "아모레퍼시픽", "AMOREPACIFIC", ["beauty"]),
    ("mfr_017", "LG생활건강", "LG H&H", ["beauty"]),
    ("mfr_018", "코스알엑스", "COSRX", ["beauty"]),
    ("mfr_019", "닥터자르트", "Dr. Jart+", ["beauty"]),
    ("mfr_020", "미샤", "MISSHA", ["beauty"]),
    ("mfr_021", "토니모리", "TONYMOLY", ["beauty"]),
    ("mfr_022", "잇츠스킨", "It's Skin", ["beauty"]),
    ("mfr_023", "메디힐", "MEDIHEAL", ["beauty"]),
    ("mfr_024", "클리오", "CLIO", ["beauty"]),
    ("mfr_025", "코스맥스", "Cosmax (ODM)", ["beauty"]),
    ("mfr_026", "종근당건강", "Chong Kun Dang Health", ["grocery"]),
    ("mfr_027", "동아제약", "Dong-A Pharm", ["grocery"]),
    ("mfr_028", "일동후디스", "Ildong Foodis", ["grocery"]),
    ("mfr_029", "매일맘마밀", "Maeil Mammamil", ["grocery"]),
    ("mfr_030", "솔가코리아", "Solgar Korea", ["grocery"]),
]


def manufacturers() -> List[Manufacturer]:
    return [
        Manufacturer(mfr_id=mid, name_ko=ko, name_en=en, country="KR", domains=domains)
        for mid, ko, en, domains in _MANUFACTURERS
    ]


# --------------------------------------------------------------------------
# Brands (60)
# --------------------------------------------------------------------------
# (brand_id, name_ko, name_en, manufacturer_id, domain, positioning_ko)
_BRANDS = [
    ("brn_001", "신라면", "Shin Ramyun", "mfr_001", "grocery", "한국 대표 매운라면"),
    ("brn_002", "새우깡", "Saewookkang", "mfr_001", "grocery", "스테디 셀러 새우 스낵"),
    ("brn_003", "진라면", "Jin Ramen", "mfr_002", "grocery", "순한맛/매운맛 라인업"),
    ("brn_004", "진간장", "Jin Soy Sauce", "mfr_002", "grocery", "양조간장 베스트셀러"),
    ("brn_005", "비비고", "bibigo", "mfr_003", "grocery", "글로벌 한식 HMR"),
    ("brn_006", "햇반", "Hetbahn", "mfr_003", "grocery", "즉석밥 카테고리 리더"),
    ("brn_007", "바나나맛우유", "Banana-flavored Milk", "mfr_004", "grocery", "노스탤직 아이코닉 가공유"),
    ("brn_008", "메로나", "Melona", "mfr_004", "grocery", "멜론맛 빙과"),
    ("brn_009", "매일우유", "Maeil Milk", "mfr_005", "grocery", "프리미엄 우유 라인"),
    ("brn_010", "상하목장", "Sangha Farm", "mfr_005", "grocery", "유기농·무항생제 프리미엄"),
    ("brn_011", "서울우유나100%", "Seoul Milk Na100", "mfr_006", "grocery", "1급A 원유"),
    ("brn_012", "살롱밀크", "Salon Milk", "mfr_006", "grocery", "프리미엄 가공유 라인"),
    ("brn_013", "맥심", "Maxim", "mfr_007", "grocery", "스틱·믹스 커피 1위"),
    ("brn_014", "포스트", "Post", "mfr_007", "grocery", "시리얼 라이센스 브랜드"),
    ("brn_015", "가나초콜릿", "Ghana Chocolate", "mfr_008", "grocery", "롱셀러 밀크초콜릿"),
    ("brn_016", "빼빼로", "Pepero", "mfr_008", "grocery", "막대 비스킷 아이코닉"),
    ("brn_017", "홈런볼", "Home Run Ball", "mfr_009", "grocery", "퍼프 비스킷"),
    ("brn_018", "허니버터칩", "Honey Butter Chip", "mfr_009", "grocery", "달콤짭짤 감자칩 트렌드"),
    ("brn_019", "풀무원두부", "Pulmuone Tofu", "mfr_010", "grocery", "프리미엄 두부 카테고리 리더"),
    ("brn_020", "두유드림", "DOYU Dream", "mfr_010", "grocery", "비건 두유 라인 (synthetic)"),
    ("brn_021", "야쿠르트", "Yakult", "mfr_011", "grocery", "유산균 발효유 원조"),
    ("brn_022", "윌", "Will", "mfr_011", "grocery", "헬리코박터 프로젝트 위용 발효유"),
    ("brn_023", "양반김", "Yangban Kim", "mfr_012", "grocery", "조미김 카테고리"),
    ("brn_024", "동원참치", "Dongwon Tuna", "mfr_012", "grocery", "참치캔 1위"),
    ("brn_025", "삼립호빵", "Samlip Hopang", "mfr_013", "grocery", "겨울 시즈널 베이커리"),
    ("brn_026", "누네띠네", "Nuneddine", "mfr_013", "grocery", "퍼프 비스킷"),
    ("brn_027", "코카콜라", "Coca-Cola", "mfr_014", "grocery", "글로벌 탄산음료"),
    ("brn_028", "토레타", "Toreta", "mfr_014", "grocery", "비탄산 기능성 음료"),
    ("brn_029", "칠성사이다", "Chilsung Cider", "mfr_015", "grocery", "한국 대표 사이다"),
    ("brn_030", "핫식스", "Hot6", "mfr_015", "grocery", "에너지드링크 국산"),
    ("brn_031", "설화수", "Sulwhasoo", "mfr_016", "beauty", "프레스티지 한방"),
    ("brn_032", "라네즈", "LANEIGE", "mfr_016", "beauty", "워터·수면팩 시그니처"),
    ("brn_033", "이니스프리", "innisfree", "mfr_016", "beauty", "제주·자연주의 친환경"),
    ("brn_034", "더후", "The whoo", "mfr_017", "beauty", "프레스티지 한방"),
    ("brn_035", "오휘", "OHUI", "mfr_017", "beauty", "프리미엄 미백·주름개선"),
    ("brn_036", "프로스트", "Frost", "mfr_017", "beauty", "더마톨로지 라인 (synthetic)"),
    ("brn_037", "코스알엑스", "COSRX", "mfr_018", "beauty", "민감성·여드름 클린"),
    ("brn_038", "닥터자르트", "Dr. Jart+", "mfr_019", "beauty", "더마 코스메틱"),
    ("brn_039", "시카페어", "Cicapair", "mfr_019", "beauty", "시카 케어 시그니처 라인"),
    ("brn_040", "미샤", "MISSHA", "mfr_020", "beauty", "가성비 K-beauty"),
    ("brn_041", "어퓨", "A'PIEU", "mfr_020", "beauty", "영 코스메틱"),
    ("brn_042", "토니모리", "TONYMOLY", "mfr_021", "beauty", "캐릭터 패키징 영 라인"),
    ("brn_043", "잇츠스킨파워", "It's Skin Power", "mfr_022", "beauty", "VC10 비타민 라인"),
    ("brn_044", "메디힐", "MEDIHEAL", "mfr_023", "beauty", "마스크 시트 카테고리 리더"),
    ("brn_045", "클리오", "CLIO", "mfr_024", "beauty", "프로 컬러 메이크업"),
    ("brn_046", "페리페라", "peripera", "mfr_024", "beauty", "영 컬러 라인"),
    ("brn_047", "클린베이스", "CleanBase", "mfr_025", "beauty", "민감 베이스 라인 (synthetic)"),
    ("brn_048", "락토핏", "LACTO-FIT", "mfr_026", "grocery", "프로바이오틱스 1위"),
    ("brn_049", "종근당비타민", "CKD Vitamin", "mfr_026", "grocery", "비타민 패밀리"),
    ("brn_050", "박카스", "Bacchus", "mfr_027", "grocery", "자양강장제 (의약외품)"),
    ("brn_051", "비타500", "Vita500", "mfr_027", "grocery", "비타민C 음료"),
    ("brn_052", "후디스", "Foodis", "mfr_028", "grocery", "영유아 통합 라인"),
    ("brn_053", "산양분유", "Goat Formula", "mfr_028", "grocery", "산양유 분유"),
    ("brn_054", "맘마밀", "Mammamil", "mfr_029", "grocery", "이유식 단계별 라인"),
    ("brn_055", "솔가", "Solgar", "mfr_030", "grocery", "수입 비타민 프리미엄"),
    ("brn_056", "센트룸", "Centrum", "mfr_030", "grocery", "종합비타민 글로벌"),
    ("brn_057", "비건뷰티스토리", "VeganBeautyStory", "mfr_025", "beauty", "비건 인증 시리즈 (synthetic)"),
    ("brn_058", "캠핑먹거리", "CampMeals", "mfr_003", "grocery", "캠핑 HMR 라인 (synthetic)"),
    ("brn_059", "임산부드림", "MomDream", "mfr_010", "grocery", "임산부 친화 두유·차 라인 (synthetic)"),
    ("brn_060", "베베클린", "BebeClean", "mfr_018", "beauty", "베이비/극저자극 라인 (synthetic)"),
]


def brands() -> List[Brand]:
    return [
        Brand(
            brand_id=bid,
            name_ko=ko,
            name_en=en,
            manufacturer_id=mid,
            domain=domain,
            positioning_ko=pos,
        )
        for bid, ko, en, mid, domain, pos in _BRANDS
    ]


# --------------------------------------------------------------------------
# Concerns (25) — wow concerns get prefer/avoid ingredient links populated.
# --------------------------------------------------------------------------
_CONCERNS = [
    ("con_01", "민감성", "Sensitive Skin", "skin",
     "외부 자극에 쉽게 붉어지거나 따가워하는 피부",
     ["inci:centella-asiatica-extract", "inci:madecassoside", "inci:panthenol", "inci:allantoin",
      "inci:ceramide-np", "inci:titanium-dioxide", "inci:zinc-oxide"],
     ["inci:fragrance", "inci:sodium-lauryl-sulfate", "inci:salicylic-acid"]),
    ("con_02", "여드름", "Acne / Blemish-prone", "skin",
     "피지 과다와 모공 막힘으로 트러블이 자주 나는 피부",
     ["inci:salicylic-acid", "inci:melaleuca-alternifolia-leaf-oil", "inci:propolis-extract",
      "inci:zinc-pca", "inci:niacinamide"],
     ["inci:dimethicone"]),
    ("con_03", "건조함", "Dryness", "skin",
     "수분·유분 부족으로 당김과 각질이 발생하는 피부",
     ["inci:hyaluronic-acid", "inci:sodium-hyaluronate", "inci:ceramide-np", "inci:squalane",
      "inci:glycerin", "inci:panthenol"],
     []),
    ("con_04", "모공", "Large Pores", "skin",
     "모공 확장과 블랙헤드가 신경 쓰이는 피부", [], []),
    ("con_05", "색소침착", "Hyperpigmentation", "skin",
     "기미·잡티·여드름 자국 등 색소 침착이 두드러지는 피부",
     ["inci:niacinamide", "inci:arbutin", "inci:ascorbic-acid", "inci:ascorbyl-glucoside",
      "inci:ethyl-ascorbic-acid"],
     []),
    ("con_06", "주름", "Wrinkles", "skin",
     "탄력 저하와 잔주름이 신경 쓰이는 피부",
     ["inci:retinol", "inci:adenosine", "inci:bakuchiol", "inci:acetyl-hexapeptide-8"],
     []),
    ("con_07", "다크써클", "Dark Circles", "skin",
     "눈 밑 다크써클이 두드러지는 부위", [], []),
    ("con_08", "홍조", "Redness / Rosacea", "skin",
     "쉽게 붉어지고 진정이 필요한 피부",
     ["inci:centella-asiatica-extract", "inci:madecassoside", "inci:bisabolol", "inci:panthenol"],
     ["inci:fragrance"]),
    ("con_09", "피지", "Sebum / Oily T-zone", "skin",
     "T존 중심 과도한 피지 분비", [], []),
    ("con_10", "각질", "Rough Skin / Keratin", "skin",
     "각질로 거칠어진 피부 결", [], []),
    ("con_11", "다이어트", "Weight Management", "diet",
     "체중 관리·저칼로리 식단을 유지하는 라이프스타일", [], []),
    ("con_12", "글루텐알레르기", "Gluten Allergy / Celiac", "diet",
     "글루텐 섭취가 어려운 식이 제한", [], []),
    ("con_13", "락토프리", "Lactose Intolerance", "diet",
     "유당 분해가 어려운 식이 제한", [], []),
    ("con_14", "저당", "Low Sugar / Diabetic Friendly", "diet",
     "당류 섭취 조절이 필요한 식단", [], []),
    ("con_15", "고단백", "High Protein", "diet",
     "근력 운동·체형 관리 위한 단백질 보충", [], []),
    ("con_16", "임산부친화", "Pregnancy-Safe", "diet",
     "임신·수유기에 적합한 성분만 섭취/사용",
     ["inci:bakuchiol", "inci:zinc-oxide", "inci:titanium-dioxide", "inci:hyaluronic-acid"],
     ["ntr:caffeine", "ntr:alcohol", "inci:retinol", "inci:retinyl-palmitate",
      "inci:retinyl-acetate", "inci:salicylic-acid"]),
    ("con_17", "영유아친화", "Baby/Toddler Safe", "diet",
     "영유아·어린이가 안전하게 먹거나 사용할 수 있는 제품",
     ["inci:zinc-oxide", "inci:panthenol", "inci:centella-asiatica-extract"],
     ["inci:fragrance", "inci:sodium-lauryl-sulfate", "ntr:caffeine"]),
    ("con_18", "비건", "Vegan", "diet",
     "동물성 원료 미사용·미테스트 제품",
     [],
     ["inci:snail-secretion-filtrate", "inci:honey-extract", "inci:hydrolyzed-collagen",
      "inci:royal-jelly-extract"]),
    ("con_19", "견과알레르기", "Nut Allergy", "diet",
     "견과류 알레르기로 섭취 회피", [], []),
    ("con_20", "카페인회피", "Caffeine-Free", "diet",
     "카페인을 피해야 하는 라이프스타일",
     [],
     ["ntr:caffeine"]),
    ("con_21", "캠핑야외", "Camping / Outdoor", "lifestyle",
     "캠핑·야외활동에 적합한 휴대성·간편성", [], []),
    ("con_22", "야식", "Late-Night Snack", "lifestyle",
     "늦은 시간 가벼운 한 끼·간식", [], []),
    ("con_23", "숙취", "Hangover Recovery", "lifestyle",
     "음주 후 회복 음료·식품", [], []),
    ("con_24", "운동", "Workout / Sports", "lifestyle",
     "운동 전후 보충·수분/전해질", [], []),
    ("con_25", "출근길", "Commute / Quick Meal", "lifestyle",
     "출근·이동 중 간편 한 끼", [], []),
]


def concerns() -> List[Concern]:
    return [
        Concern(
            concern_id=cid,
            name_ko=ko,
            name_en=en,
            domain=domain,
            description_ko=desc,
            prefers_ingredient_ids=prefers,
            avoids_ingredient_ids=avoids,
        )
        for cid, ko, en, domain, desc, prefers, avoids in _CONCERNS
    ]


# --------------------------------------------------------------------------
# Trends (30) — wow trends get ingredient/category links populated.
# --------------------------------------------------------------------------
_TRENDS = [
    ("trn_01", "여름철 자외선차단", "Summer SPF", "seasonal",
     "여름철 일광 노출 증가에 따라 무기자차·고차단 자외선차단제 수요 급증",
     ["inci:titanium-dioxide", "inci:zinc-oxide"], [], "2025-여름"),
    ("trn_02", "환절기 보습", "Transition Season Hydration", "seasonal",
     "기온/습도 변화에 따른 장벽 강화·집중 보습 케어 트렌드",
     ["inci:hyaluronic-acid", "inci:ceramide-np", "inci:squalane"], [], "2025-가을"),
    ("trn_03", "겨울철 입욕", "Winter Bath Care", "seasonal",
     "추위 대응 입욕 케어 및 바디 보습", [], [], "2025-겨울"),
    ("trn_04", "한파 보온식품", "Winter Warm Foods", "seasonal",
     "기온 급강하 시 호빵·국물·죽류 매출 증가", [], ["10000700", "10000801"], "2025-겨울"),
    ("trn_05", "폭염 시즈널 음료", "Heatwave Beverages", "seasonal",
     "폭염 기간 이온음료·생수·아이스 RTD 음료 폭증",
     [], ["10000400", "10000248", "10000246"], "2025-여름"),
    ("trn_06", "시카케어", "Cica Care", "kbeauty",
     "병풀 추출물 기반 진정·재생 라인업의 지속 인기",
     ["inci:centella-asiatica-extract", "inci:madecassoside", "inci:asiaticoside"], [], "2024-2026"),
    ("trn_07", "슬로우뷰티", "Slow Beauty", "kbeauty",
     "단계 축소·고기능 단일 제품 트렌드", [], [], "2025-Q2"),
    ("trn_08", "클린뷰티", "Clean Beauty", "kbeauty",
     "유해 의심 성분(향료/SLS/파라벤) 회피 및 EWG 등급 마케팅", [], [], "2024-2026"),
    ("trn_09", "비건뷰티", "Vegan Beauty", "kbeauty",
     "동물성 원료·동물실험 미사용 인증 제품 확대", [], [], "2025-Q1"),
    ("trn_10", "더마코스메틱", "Dermo-cosmetics", "kbeauty",
     "피부과학 기반·민감성 케어 라인 확장",
     ["inci:panthenol", "inci:ceramide-np", "inci:bisabolol"], [], "2024-2026"),
    ("trn_11", "미니멀스킨케어", "Minimalist Skincare", "kbeauty",
     "3-step 이하 단순화 루틴", [], [], "2025-Q3"),
    ("trn_12", "한방화장품", "Hanbang Cosmetics", "kbeauty",
     "전통 한방 원료(인삼/홍삼/감초) 기반 안티에이징",
     ["inci:ginseng-root-extract", "inci:licorice-root-extract"], [], "2024-2026"),
    ("trn_13", "베이비스킨케어", "Baby Skincare", "kbeauty",
     "영유아·민감성 성인 공용 저자극 라인", [], [], "2025-Q2"),
    ("trn_14", "저당다이어트", "Low-Sugar Diet", "diet",
     "당류 저감·제로슈가 트렌드 확산", [], ["10000159"], "2024-2026"),
    ("trn_15", "고단백트렌드", "High-Protein", "diet",
     "단백질 음료·바·시리얼 카테고리 확대",
     [], ["10000228"], "2024-2026"),
    ("trn_16", "글루텐프리", "Gluten-Free", "diet",
     "글루텐 알레르기·셀리악 대응 라이프스타일 식품",
     [], ["10001500", "10000605", "10001200"], "2025-Q1"),
    ("trn_17", "비건식품", "Vegan Food", "diet",
     "두유·식물성 단백질·식물성 우유 대체식품 성장",
     [], ["10000066"], "2024-2026"),
    ("trn_18", "저칼로리간식", "Low-Calorie Snacks", "diet",
     "100kcal 이하 소포장 스낵 라인", [], ["10000604", "10000228"], "2025-Q2"),
    ("trn_19", "발효슈퍼푸드", "Fermented Superfoods", "diet",
     "김치·콤부차·요거트 등 발효식품 글로벌 확산", [], [], "2024-2026"),
    ("trn_20", "단백질음료", "Protein Drinks", "diet",
     "운동/직장인 단백질 보충 RTD 음료 급증", [], ["10000160"], "2025-Q2"),
    ("trn_21", "락토프리", "Lactose-Free Dairy", "diet",
     "유당불내증 대응 락토프리 우유·요거트",
     [], ["10000064", "10000148"], "2025-Q1"),
    ("trn_22", "멘탈헬스음료", "Mental Wellness Drinks", "functional",
     "GABA·테아닌·아쉬와간다 첨가 진정 음료", [], [], "2025-Q3"),
    ("trn_23", "슬립푸드", "Sleep Food", "functional",
     "수면 개선 음료·간식 (멜라토닌·체리주스 등)", [], [], "2025-Q2"),
    ("trn_24", "면역력", "Immunity", "functional",
     "프로폴리스·홍삼·비타민C 면역 보충", [], ["10001300", "10001301"], "2024-2026"),
    ("trn_25", "장건강", "Gut Health", "functional",
     "프로바이오틱스·프리바이오틱스 유산균 시장 확대",
     [], ["10001301"], "2024-2026"),
    ("trn_26", "눈건강", "Eye Health", "functional",
     "루테인·블루베리 등 눈 영양 보충", [], ["10001300"], "2025-Q1"),
    ("trn_27", "김치콤부차", "Kimchi Kombucha", "korea",
     "한국 발효식품의 글로벌 트렌드화", [], [], "2025-Q3"),
    ("trn_28", "약콩건강식", "Korean Medicinal Beans", "korea",
     "검정콩·서리태 등 한방 곡물 건강식", [], [], "2024-2026"),
    ("trn_29", "인삼르네상스", "Ginseng Renaissance", "korea",
     "MZ세대 대상 인삼·홍삼 리브랜딩",
     ["inci:ginseng-root-extract"], [], "2025-Q2"),
    ("trn_30", "한식비건", "Korean Vegan Cuisine", "korea",
     "사찰음식·한식 베이스 비건 라인", [], [], "2025-Q3"),
]


def trends() -> List[Trend]:
    return [
        Trend(
            trend_id=tid,
            name_ko=ko,
            name_en=en,
            type=ttype,
            description_ko=desc,
            involves_ingredient_ids=ings,
            involves_brick_codes=cats,
            emerged_period=period,
        )
        for tid, ko, en, ttype, desc, ings, cats, period in _TRENDS
    ]


# --------------------------------------------------------------------------
# Channels (4)
# --------------------------------------------------------------------------
_CHANNELS = [
    ("chn_cu", "CU 편의점", "편의점"),
    ("chn_emart", "이마트", "마트"),
    ("chn_oliveyoung", "올리브영", "드럭스토어"),
    ("chn_kurly", "마켓컬리", "온라인"),
]


def channels() -> List[Channel]:
    return [Channel(channel_id=cid, name_ko=ko, type=t) for cid, ko, t in _CHANNELS]


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def _dump(items, filename: str) -> None:
    out = OUTPUT_DIR / filename
    payload = [item.model_dump(exclude_none=True) for item in items]
    out.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  wrote {len(items):3d} → {out.relative_to(OUTPUT_DIR.parents[1])}")


def main() -> None:
    print("Generating deterministic data…")
    _dump(manufacturers(), "manufacturers.json")
    _dump(brands(), "brands.json")
    _dump(concerns(), "concerns.json")
    _dump(trends(), "trends.json")
    _dump(channels(), "channels.json")
    print("Done.")


if __name__ == "__main__":
    main()
