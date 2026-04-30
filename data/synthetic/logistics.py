"""Logistics / SCM / Events synthetic generator (fully deterministic).

Produces six datasets that join the existing graph:
  - regions      (read from ontology/mappings/korea-regions.csv)
  - warehouses   (DCs operated by manufacturers, channels, and 3PLs)
  - carriers     (6 major Korean parcel/freight carriers)
  - routes       (lanes between warehouses)
  - shipments    (last 30 days of synthetic shipments)
  - events       (12 events spanning seasonal/promo/disaster/strike/outage)

Determinism is critical: re-running this generator must produce the same
output. SHA1-based PRNGs are used everywhere; no `random.random()`.

Run:  python -m data.synthetic.logistics
Outputs to data/output/{regions,warehouses,carriers,routes,shipments,events}.json
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output"
MAPPING_DIR = Path(__file__).resolve().parent.parent.parent / "ontology" / "mappings"

# Anchor date for synthetic events / shipments. Derived from a fixed string
# so the dataset is reproducible regardless of when the generator runs.
ANCHOR_DATE = date(2026, 4, 1)


def _stable_int(*parts: str, mod: int) -> int:
    h = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()
    return int(h[:8], 16) % max(1, mod)


def _stable_pick(seed: str, options: List[Any]) -> Any:
    return options[_stable_int(seed, mod=len(options))]


def load_regions() -> List[Dict[str, Any]]:
    path = MAPPING_DIR / "korea-regions.csv"
    out: List[Dict[str, Any]] = []
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            out.append({
                "region_code": row["region_code"].strip(),
                "name_ko":     row["name_ko"].strip(),
                "name_en":     row["name_en"].strip() or None,
                "level":       row["level"].strip(),
                "parent_code": row["parent_code"].strip() or None,
                "lat":         float(row["lat"]),
                "lng":         float(row["lng"]),
                "population":  int(row["population"]) if row["population"] else None,
            })
    return out


# ─── Warehouses ─────────────────────────────────────────────────────────────
#
# 30 warehouses split across:
#   - 8 large DCs near major metro areas (mfr + rdc mix)
#   - 12 mid-tier regional DCs
#   - 10 last-mile fulfillment centers (urban, channel-aligned)
#
# Locations are hand-picked to match real Korean retail logistics geography:
# Manufacturer DCs cluster near manufacturing belts (수도권 남부, 경남, 충청).
# Channel RDCs cluster near consumer demand (수도권 + 영남권).

_WAREHOUSE_SEED: List[Tuple[str, str, str, str, int, bool]] = [
    # (name_ko, type, region_code, operator, capacity_pallets, cold_chain)
    # type=mfr / rdc / 3pl / lastmile
    # operator: manufacturer name fragment OR channel_id OR "" for 3PL
    # ── Large mfr DCs ──
    ("이천 통합물류센터",     "mfr",      "31",   "신세계푸드",  18000, True),
    ("화성 식품물류센터",     "mfr",      "31",   "오뚜기",      14000, True),
    ("천안 뷰티물류센터",     "mfr",      "34",   "아모레퍼시픽", 12000, False),
    ("성남 종합DC",           "mfr",      "31",   "LG생활건강",  11000, False),
    # ── Channel RDCs ──
    ("이마트 평택RDC",        "rdc",      "31",   "chn_emart",     20000, True),
    ("이마트 김해RDC",        "rdc",      "38",   "chn_emart",     15000, True),
    ("올리브영 인천DC",       "rdc",      "23",   "chn_oliveyoung", 9000, False),
    ("CU 오산DC",             "rdc",      "31",   "chn_cu",        12000, True),
    # ── Mid-tier regional DCs ──
    ("쿠팡 대구FC",           "rdc",      "22",   "쿠팡",          14000, True),
    ("쿠팡 광주FC",           "rdc",      "24",   "쿠팡",          11000, True),
    ("마컬 김포센터",         "rdc",      "31",   "chn_kurly",     10000, True),
    ("마컬 송파센터",         "rdc",      "11",   "chn_kurly",      8000, True),
    ("CU 대전DC",             "rdc",      "25",   "chn_cu",         9000, True),
    ("올리브영 부산DC",       "rdc",      "21",   "chn_oliveyoung", 7000, False),
    ("이마트 청주RDC",        "rdc",      "33",   "chn_emart",     11000, True),
    ("CJ제일제당 청주공장DC", "mfr",      "33",   "CJ제일제당",   13000, True),
    # ── 3PL ──
    ("CJ대한통운 용인HUB",    "3pl",      "31",   "",              25000, False),
    ("한진 대전허브",         "3pl",      "25",   "",              16000, False),
    ("롯데택배 옥천허브",     "3pl",      "33",   "",              14000, False),
    ("판토스 부산항터미널",   "3pl",      "21",   "",              18000, True),
    # ── Last-mile (urban) ──
    ("쿠팡 송파LM",           "lastmile", "11",   "쿠팡",           2500, False),
    ("쿠팡 강서LM",           "lastmile", "11",   "쿠팡",           2500, False),
    ("쿠팡 해운대LM",         "lastmile", "21",   "쿠팡",           2000, False),
    ("마컬 강남LM",           "lastmile", "11",   "chn_kurly",      1800, True),
    ("마컬 분당LM",           "lastmile", "31",   "chn_kurly",      1800, True),
    ("배민 마포LM",           "lastmile", "11",   "배민",           1500, True),
    ("배민 동탄LM",           "lastmile", "31",   "배민",           1500, True),
    ("올리브영 강남LM",       "lastmile", "11",   "chn_oliveyoung", 1200, False),
    ("CU 인천공항LM",         "lastmile", "23",   "chn_cu",         1000, True),
    ("올리브영 동대문LM",     "lastmile", "11",   "chn_oliveyoung", 1100, False),
]


def generate_warehouses(regions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    region_centroid = {r["region_code"]: (r["lat"], r["lng"]) for r in regions}
    out: List[Dict[str, Any]] = []
    for i, (name, wtype, rcode, operator, cap, cold) in enumerate(_WAREHOUSE_SEED):
        wh_id = f"wh_{i+1:03d}"
        # Jitter the warehouse position within ±0.05° of the region centroid
        # so co-located warehouses don't render exactly on top of each other.
        base_lat, base_lng = region_centroid.get(rcode, (37.5, 127.0))
        jit_lat = (_stable_int(wh_id, "lat", mod=200) - 100) / 2000.0  # ±0.05°
        jit_lng = (_stable_int(wh_id, "lng", mod=200) - 100) / 2000.0
        wh: Dict[str, Any] = {
            "wh_id": wh_id,
            "name_ko": name,
            "type": wtype,
            "region_code": rcode,
            "lat": round(base_lat + jit_lat, 5),
            "lng": round(base_lng + jit_lng, 5),
            "capacity_pallets": cap,
            "cold_chain": cold,
            "operator_mfr_id": None,
            "operator_channel_id": None,
        }
        # Operator routing: channel_id strings start with "chn_", others
        # are manufacturer label_ko fragments (matched at load time to
        # actual Manufacturer mfr_id by name).
        if operator.startswith("chn_"):
            wh["operator_channel_id"] = operator
        elif operator:
            wh["operator_mfr_id"] = operator   # resolved at loader time
        out.append(wh)
    return out


# ─── Carriers ───────────────────────────────────────────────────────────────

_CARRIERS: List[Dict[str, Any]] = [
    {"carrier_id": "car_cj",     "name_ko": "CJ대한통운",   "name_en": "CJ Logistics",  "mode": "parcel", "domestic": True},
    {"carrier_id": "car_hanjin", "name_ko": "한진택배",     "name_en": "Hanjin",         "mode": "parcel", "domestic": True},
    {"carrier_id": "car_lotte",  "name_ko": "롯데택배",     "name_en": "Lotte Logis",    "mode": "parcel", "domestic": True},
    {"carrier_id": "car_post",   "name_ko": "우체국택배",   "name_en": "Korea Post",     "mode": "parcel", "domestic": True},
    {"carrier_id": "car_coupang","name_ko": "쿠팡로지스틱스","name_en": "Coupang Logis",  "mode": "parcel", "domestic": True},
    {"carrier_id": "car_pantos", "name_ko": "판토스",       "name_en": "Pantos",         "mode": "ftl",    "domestic": False},
    {"carrier_id": "car_cold",   "name_ko": "한국냉동냉장창고운영사", "name_en": "KCWA", "mode": "cold",  "domestic": True},
]


def generate_carriers() -> List[Dict[str, Any]]:
    return list(_CARRIERS)


# ─── Routes ─────────────────────────────────────────────────────────────────
#
# Three lane patterns:
#   1. Manufacturer DC → 3PL hub → Channel RDC (multi-hop)
#   2. Channel RDC → Last-mile (urban distribution)
#   3. 3PL hub → Channel RDC (cross-dock)
#
# Carrier selection: cold-chain WHs prefer car_cold or car_cj; last-mile
# uses parcel carriers; 3PL→3PL uses car_pantos for FTL.


def _haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    import math
    lat1, lng1 = a; lat2, lng2 = b
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    h = (math.sin(dlat/2)**2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlng/2)**2)
    return round(R * 2 * math.atan2(math.sqrt(h), math.sqrt(1-h)), 1)


def generate_routes(warehouses: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_id = {w["wh_id"]: w for w in warehouses}
    mfr  = [w for w in warehouses if w["type"] == "mfr"]
    rdc  = [w for w in warehouses if w["type"] == "rdc"]
    hub  = [w for w in warehouses if w["type"] == "3pl"]
    lm   = [w for w in warehouses if w["type"] == "lastmile"]

    out: List[Dict[str, Any]] = []
    rid = 1

    def _add(from_w: Dict[str, Any], to_w: Dict[str, Any], carrier_id: str) -> None:
        nonlocal rid
        dist = _haversine_km((from_w["lat"], from_w["lng"]), (to_w["lat"], to_w["lng"]))
        # 60 km/h average for road; +1h handling per node.
        transit = round(dist / 60.0 + 1.0, 1)
        out.append({
            "route_id":     f"rt_{rid:04d}",
            "from_wh_id":   from_w["wh_id"],
            "to_wh_id":     to_w["wh_id"],
            "carrier_id":   carrier_id,
            "mode":         "road",
            "transit_hours": transit,
            "distance_km":   dist,
        })
        rid += 1

    # 1. Each mfr → 2 nearest hubs
    for m in mfr:
        ranked_hubs = sorted(
            hub,
            key=lambda h: _haversine_km((m["lat"], m["lng"]), (h["lat"], h["lng"])),
        )[:2]
        for h in ranked_hubs:
            carrier = "car_cold" if m["cold_chain"] else "car_pantos"
            _add(m, h, carrier)

    # 2. Each hub → all RDCs (cross-dock cloud)
    for h in hub:
        for r in rdc:
            carrier = _stable_pick(f"hub-{h['wh_id']}-rdc-{r['wh_id']}",
                                   ["car_cj", "car_hanjin", "car_lotte"])
            if r["cold_chain"] and h["wh_id"] == "wh_017":  # CJ대한통운 hub also runs cold lanes
                carrier = "car_cold"
            _add(h, r, carrier)

    # 3. Each RDC → 1-2 nearest last-mile
    for r in rdc:
        ranked_lm = sorted(
            lm,
            key=lambda x: _haversine_km((r["lat"], r["lng"]), (x["lat"], x["lng"])),
        )[:2]
        for x in ranked_lm:
            carrier = _stable_pick(f"rdc-{r['wh_id']}-lm-{x['wh_id']}",
                                   ["car_cj", "car_coupang", "car_post"])
            _add(r, x, carrier)

    return out


# ─── Shipments ──────────────────────────────────────────────────────────────


def generate_shipments(
    routes: List[Dict[str, Any]],
    sku_ids: List[str],
    *,
    days: int = 30,
    per_route_per_day: int = 1,
) -> List[Dict[str, Any]]:
    """Generate ~`days * len(routes) * per_route_per_day` shipments anchored
    to ANCHOR_DATE. Status distribution: 70% delivered, 18% in_transit, 8%
    delayed, 4% exception."""
    out: List[Dict[str, Any]] = []
    sid = 1
    for d_offset in range(days):
        ship_date = ANCHOR_DATE - timedelta(days=days - d_offset)
        for route in routes:
            for k in range(per_route_per_day):
                shipment_id = f"sh_{sid:06d}"
                # Deterministic SKU pick: 2-5 SKUs per shipment
                n_sku = 2 + _stable_int(shipment_id, "n", mod=4)
                picked: List[str] = []
                for i in range(n_sku):
                    if not sku_ids:
                        break
                    picked.append(sku_ids[_stable_int(shipment_id, f"sku-{i}", mod=len(sku_ids))])
                pallets = 1 + _stable_int(shipment_id, "pal", mod=8)
                # Status mix
                roll = _stable_int(shipment_id, "status", mod=100)
                if roll < 70:
                    status = "delivered"
                    delivered_at = ship_date + timedelta(days=1 if route["transit_hours"] < 24 else 2)
                    delay = None
                elif roll < 88:
                    status = "in_transit"
                    delivered_at = None
                    delay = None
                elif roll < 96:
                    status = "delayed"
                    delivered_at = None
                    delay = "carrier_capacity"
                else:
                    status = "exception"
                    delivered_at = None
                    delay = "damaged_pallet"
                out.append({
                    "shipment_id":   shipment_id,
                    "route_id":      route["route_id"],
                    "carrier_id":    route["carrier_id"],
                    "sku_ids":       picked,
                    "pallets":       pallets,
                    "dispatched_at": ship_date.isoformat(),
                    "delivered_at":  delivered_at.isoformat() if delivered_at else None,
                    "status":        status,
                    "delay_reason":  delay,
                })
                sid += 1
    return out


# ─── Events ─────────────────────────────────────────────────────────────────


_EVENTS: List[Dict[str, Any]] = [
    {
        "event_id": "ev_seol_2026", "name_ko": "설날 명절 수요 폭증",
        "type": "seasonal", "start": "2026-02-12", "end": "2026-02-18", "severity": 4,
        "description_ko": "구정(설날) 전후 선물 세트 수요 폭증. 정육·과일·전통주·뷰티 선물세트가 평소 대비 3-5배 급증.",
        "demand_multiplier": 3.5,
        "affected_brick_codes": ["10000159", "10000162", "10000201", "50232100"],
    },
    {
        "event_id": "ev_chuseok_2026", "name_ko": "추석 명절 수요 폭증",
        "type": "seasonal", "start": "2026-09-23", "end": "2026-09-30", "severity": 5,
        "description_ko": "추석 선물세트·차례용품 수요 정점. 한과·과일선물·축산선물·생활용품 세트.",
        "demand_multiplier": 4.0,
        "affected_brick_codes": ["10000159", "10000162", "10000201"],
    },
    {
        "event_id": "ev_summer_heat_2026", "name_ko": "역대급 폭염",
        "type": "disaster", "start": "2026-07-15", "end": "2026-08-20", "severity": 4,
        "description_ko": "기상청 폭염주의보. 음료·아이스크림 수요 급증, 신선식품 폐기율 상승.",
        "demand_multiplier": 2.0,
        "affected_region_codes": ["11", "21", "22", "23", "31"],
        "affected_brick_codes": ["10000301", "10000305"],
    },
    {
        "event_id": "ev_typhoon_aug_2026", "name_ko": "8월 태풍 공급 차질",
        "type": "disaster", "start": "2026-08-25", "end": "2026-08-29", "severity": 5,
        "description_ko": "남부 지방 태풍 직격, 부산·여수·창원 항만 폐쇄, 영남권 대형마트 입고 지연.",
        "demand_multiplier": 0.6,
        "affected_region_codes": ["21", "36", "37", "38"],
    },
    {
        "event_id": "ev_winter_cold_2026", "name_ko": "1월 한파",
        "type": "disaster", "start": "2026-01-08", "end": "2026-01-15", "severity": 3,
        "description_ko": "전국 한파 특보. 난방용품·핫팩·간편식 수요 급증.",
        "demand_multiplier": 1.8,
    },
    {
        "event_id": "ev_blackfriday_2026", "name_ko": "코리아 블랙프라이데이",
        "type": "promo", "start": "2026-11-13", "end": "2026-11-29", "severity": 3,
        "description_ko": "산업부 주관 대규모 할인 행사. 전 채널 매출 평균 2배 증가.",
        "demand_multiplier": 2.0,
    },
    {
        "event_id": "ev_school_2026", "name_ko": "신학기 수요",
        "type": "seasonal", "start": "2026-02-25", "end": "2026-03-15", "severity": 2,
        "description_ko": "초·중·고 신학기 시작. 어린이 영양제·간식·학용품 수요 증가.",
        "demand_multiplier": 1.4,
        "affected_brick_codes": ["10000301"],
    },
    {
        "event_id": "ev_strike_logis_2026", "name_ko": "화물연대 부분 파업",
        "type": "strike", "start": "2026-06-10", "end": "2026-06-14", "severity": 4,
        "description_ko": "화물연대 부분 파업으로 부산항·울산항 컨테이너 처리 지연. 수입 원재료·식자재 입고 지체.",
        "demand_multiplier": 0.85,
        "affected_region_codes": ["21", "26"],
    },
    {
        "event_id": "ev_outage_kurly_2026", "name_ko": "마컬 송파센터 일시 정전",
        "type": "outage", "start": "2026-05-03", "end": "2026-05-04", "severity": 3,
        "description_ko": "전기실 화재로 마컬 송파센터 24시간 가동 중단. 새벽배송 결품 발생.",
        "demand_multiplier": 0.0,
        "affected_region_codes": ["11"],
    },
    {
        "event_id": "ev_kbeauty_show_2026", "name_ko": "K-Beauty Expo 서울",
        "type": "promo", "start": "2026-10-08", "end": "2026-10-12", "severity": 2,
        "description_ko": "코엑스 K-Beauty Expo. 시카·바쿠치올·프로폴리스 카테고리 검색 폭증.",
        "demand_multiplier": 1.7,
    },
    {
        "event_id": "ev_world_cup_2026", "name_ko": "월드컵 본선 진출",
        "type": "promo", "start": "2026-11-30", "end": "2026-12-15", "severity": 3,
        "description_ko": "한국 월드컵 본선 진출. 야식·맥주·치킨·홈파티 용품 수요 폭증.",
        "demand_multiplier": 1.9,
    },
    {
        "event_id": "ev_kakao_xmas_2026", "name_ko": "카카오 크리스마스 선물 캠페인",
        "type": "promo", "start": "2026-12-20", "end": "2026-12-26", "severity": 2,
        "description_ko": "카카오톡 선물하기 크리스마스 한정판 푸시. 뷰티·디저트 카테고리 모바일 결제 급증.",
        "demand_multiplier": 1.6,
    },
]


def generate_events(routes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Stamp affected route_ids onto disaster/strike/outage events using
    region overlap (route's source/target warehouse region matches the
    event's affected_region_codes)."""
    # Cache: route_id -> set of region_codes touched (from + to warehouse)
    return [dict(e) for e in _EVENTS]   # routes wired at loader time via region join


# ─── Inventory ──────────────────────────────────────────────────────────────
#
# For each warehouse we pick an SKU subset based on warehouse type:
#   - mfr DC : holds full assortment of operating manufacturer's brand SKUs
#              (and a few cross-stock items)
#   - rdc    : channel-aligned SKUs (chn_emart RDC = grocery + mass beauty;
#              chn_oliveyoung = beauty heavy; chn_kurly = premium grocery)
#   - 3pl    : transient — small holdings of high-velocity SKUs
#   - lastmile: very low holdings, only top SKUs near the urban demand center
#
# on_hand_pallets is deterministic from sha1(wh_id, sku_id). Pre-`days_of_cover`
# is computed from on-hand and a simulated daily-throughput rate (pallets/day).


def _infer_domain(sku_id: str, products: List[Dict[str, Any]]) -> str:
    """Return 'beauty' or 'grocery' for a SKU — reads from products feed."""
    for p in products:
        if p.get("sku_id") == sku_id:
            return p.get("domain", "grocery")
    return "grocery"


def generate_inventory(
    warehouses: List[Dict[str, Any]],
    products: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    sku_to_domain: Dict[str, str] = {p["sku_id"]: p.get("domain", "grocery") for p in products}
    sku_ids = list(sku_to_domain.keys())
    out: List[Dict[str, Any]] = []

    # Per-type SKU count cap and selection bias:
    #   mfr  : 60 SKUs (mostly grocery if cold; mostly beauty if warm)
    #   rdc  : 40 SKUs (channel-aligned domain)
    #   3pl  : 30 SKUs (cross-section)
    #   lm   : 8  SKUs (top-velocity only)
    type_cap: Dict[str, int] = {"mfr": 60, "rdc": 40, "3pl": 30, "lastmile": 8}

    # Channel→domain bias for RDCs
    chn_domain: Dict[str, str] = {
        "chn_emart":      "grocery",  # grocery primary; some beauty
        "chn_kurly":      "grocery",
        "chn_cu":         "grocery",
        "chn_oliveyoung": "beauty",
    }

    for w in warehouses:
        cap = type_cap.get(w["type"], 20)
        # Score each SKU for this warehouse — higher score = more likely
        # to be carried. Deterministic shuffle via SHA1.
        scored: List[Tuple[float, str]] = []
        for sku in sku_ids:
            base = _stable_int(w["wh_id"], sku, "carry", mod=1000) / 1000.0
            domain = sku_to_domain.get(sku, "grocery")
            bias = 0.0
            if w["type"] == "rdc" and w.get("operator_channel_id"):
                want_domain = chn_domain.get(w["operator_channel_id"], "grocery")
                if domain == want_domain:
                    bias = 0.5
            elif w["type"] == "mfr":
                # mfr DCs cold-chain (식품) carry mostly grocery
                if w.get("cold_chain") and domain == "grocery":
                    bias = 0.5
                elif not w.get("cold_chain") and domain == "beauty":
                    bias = 0.5
            elif w["type"] == "lastmile" and w.get("operator_channel_id"):
                want_domain = chn_domain.get(w["operator_channel_id"], "grocery")
                if domain == want_domain:
                    bias = 0.7
            scored.append((base + bias, sku))
        scored.sort(reverse=True)
        carried = [sku for _, sku in scored[:cap]]

        for sku in carried:
            inv_id = f"inv_{w['wh_id']}_{sku}"
            on_hand = _stable_int(w["wh_id"], sku, "stock", mod=50)
            # Last-mile holdings stay small even after the 0..49 roll
            if w["type"] == "lastmile":
                on_hand = on_hand % 8
            elif w["type"] == "3pl":
                on_hand = on_hand % 25
            # Skip rows with on_hand == 0 — they'd just be noise
            if on_hand == 0:
                on_hand = 1 + _stable_int(w["wh_id"], sku, "min", mod=4)
            cap_for_sku = on_hand + 5 + _stable_int(w["wh_id"], sku, "cap", mod=15)
            # Daily throughput: RDC moves more than mfr; lastmile moves most per
            # SKU relative to holdings (small inventory cycled quickly).
            throughput_factor = {"rdc": 4, "mfr": 2, "3pl": 5, "lastmile": 8}.get(w["type"], 3)
            daily = max(0.5, throughput_factor * (1 + _stable_int(w["wh_id"], sku, "thr", mod=5)) / 5.0)
            days_of_cover = round(on_hand / daily, 1) if daily > 0 else 0.0
            # Last update — within last 14 days, deterministic
            offset = _stable_int(w["wh_id"], sku, "upd", mod=14)
            last_updated = (ANCHOR_DATE - timedelta(days=offset)).isoformat()
            temperature = "cold" if (w.get("cold_chain") and sku_to_domain.get(sku) == "grocery") else "ambient"
            out.append({
                "inv_id": inv_id,
                "wh_id": w["wh_id"],
                "sku_id": sku,
                "on_hand_pallets": on_hand,
                "capacity_pallets": cap_for_sku,
                "days_of_cover": days_of_cover,
                "last_updated": last_updated,
                "temperature": temperature,
            })
    return out


# ─── Entry point ────────────────────────────────────────────────────────────


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    regions = load_regions()
    warehouses = generate_warehouses(regions)
    carriers = generate_carriers()
    routes = generate_routes(warehouses)

    # SKUs for shipments — read existing products.ndjson if present, else stub.
    products_path = OUTPUT_DIR / "products.ndjson"
    sku_ids: List[str] = []
    if products_path.exists():
        with open(products_path, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    try:
                        sku_ids.append(json.loads(line)["sku_id"])
                    except (json.JSONDecodeError, KeyError):
                        continue
    shipments = generate_shipments(routes, sku_ids, days=30, per_route_per_day=1)
    events = generate_events(routes)

    # Inventory needs the products feed for domain inference
    products: List[Dict[str, Any]] = []
    if products_path.exists():
        with open(products_path, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    try:
                        products.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
    inventory = generate_inventory(warehouses, products)

    for name, data in [
        ("regions", regions), ("warehouses", warehouses), ("carriers", carriers),
        ("routes", routes), ("shipments", shipments), ("events", events),
        ("inventory", inventory),
    ]:
        path = OUTPUT_DIR / f"{name}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"  wrote {len(data):>4d}  {path}")


if __name__ == "__main__":
    main()
