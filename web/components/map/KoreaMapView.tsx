'use client';

// KoreaMapView — Korean sido map with choropleth + warehouse markers + lanes.
//
// Uses react-simple-maps (d3-geo) with the public 17-sido GeoJSON in
// /public/korea-provinces.json. The GeoJSON has feature.properties.code
// matching our Region.region_code (KOSTAT 행정구역코드 — "11" for 서울 etc.),
// so highlights and event overlays resolve directly.

import { useEffect, useMemo, useState } from 'react';
import {
  ComposableMap, Geographies, Geography, Marker, Line,
} from 'react-simple-maps';

const GEO_URL = '/korea-provinces.json';

export type Marker = {
  id: string;
  name: string;
  type: 'mfr' | 'rdc' | '3pl' | 'lastmile';
  coordinates: [number, number]; // [lng, lat]
  tone?: 'normal' | 'highlight' | 'warning';
  cold?: boolean;
};

export type Lane = {
  id: string;
  from: [number, number];
  to: [number, number];
  carrier_id: string;
};

export type RegionFill = {
  region_code: string;
  // 0..1 — choropleth intensity, e.g. event severity / 5
  value: number;
  hue?: 'rose' | 'amber' | 'emerald' | 'cyan';
};

const DEFAULT_FILL = '#1e293b';        // ink-800 stand-in
const STROKE       = '#334155';        // ink-700
const SELECTED     = '#0ea5e9';        // sky-500

// Choropleth color stop helpers (5-step hue ramps).
function fillFor(intensity: number, hue: RegionFill['hue'] = 'rose'): string {
  if (intensity <= 0) return DEFAULT_FILL;
  const i = Math.min(1, Math.max(0, intensity));
  const ramps: Record<NonNullable<RegionFill['hue']>, string[]> = {
    rose:    ['#1e293b', '#7f1d1d', '#b91c1c', '#dc2626', '#f43f5e'],
    amber:   ['#1e293b', '#78350f', '#b45309', '#d97706', '#fbbf24'],
    emerald: ['#1e293b', '#064e3b', '#047857', '#10b981', '#34d399'],
    cyan:    ['#1e293b', '#164e63', '#0e7490', '#0891b2', '#22d3ee'],
  };
  const stops = ramps[hue];
  const idx = Math.min(stops.length - 1, Math.floor(i * stops.length));
  return stops[idx];
}

// Per-warehouse-type marker style.
const TYPE_STYLE: Record<Marker['type'], { fill: string; r: number; ring: string }> = {
  mfr:      { fill: '#34d399', r: 6.5, ring: '#065f46' },
  rdc:      { fill: '#22d3ee', r: 5.5, ring: '#155e75' },
  '3pl':    { fill: '#f59e0b', r: 6.0, ring: '#92400e' },
  lastmile: { fill: '#a78bfa', r: 4.0, ring: '#5b21b6' },
};

// Carrier color palette for lane lines.
const CARRIER_COLORS: Record<string, string> = {
  car_cj:      '#fb7185',
  car_hanjin:  '#60a5fa',
  car_lotte:   '#fbbf24',
  car_post:    '#a78bfa',
  car_coupang: '#34d399',
  car_pantos:  '#94a3b8',
  car_cold:    '#22d3ee',
};

export type KoreaMapViewProps = {
  markers?: Marker[];
  lanes?: Lane[];
  regionFills?: RegionFill[];
  selectedRegionCode?: string | null;
  selectedMarkerId?: string | null;
  onRegionClick?: (region_code: string, name: string) => void;
  onMarkerClick?: (markerId: string) => void;
  showLanes?: boolean;
  height?: number;
};

export function KoreaMapView({
  markers = [], lanes = [], regionFills = [],
  selectedRegionCode = null, selectedMarkerId = null,
  onRegionClick, onMarkerClick, showLanes = true, height = 720,
}: KoreaMapViewProps) {
  const fillByRegion = useMemo(() => {
    const m = new Map<string, RegionFill>();
    for (const f of regionFills) m.set(f.region_code, f);
    return m;
  }, [regionFills]);

  // Korea spans ~5.5° latitude × ~7.3° longitude, but at ~36°N each lng
  // degree is only ~0.81× a lat degree, so the country is roughly
  // square-aspect. Use a tall viewBox (3:4) so the peninsula doesn't
  // get squashed into a sliver of a wide container.
  const VIEW_W = 800;
  const VIEW_H = 1000;

  return (
    <div className="w-full flex justify-center" style={{ height }}>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{
          // Center on Korean peninsula and zoom in tightly.
          center: [127.7, 36.2],
          scale: 6800,
        }}
        width={VIEW_W}
        height={VIEW_H}
        style={{ width: 'auto', height: '100%' }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }: { geographies: any[] }) =>
            geographies.map((geo) => {
              const code = String(geo.properties?.code ?? '');
              const fill = fillByRegion.get(code);
              const isSelected = selectedRegionCode === code;
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  onClick={() => onRegionClick?.(code, String(geo.properties?.name ?? ''))}
                  style={{
                    default: {
                      fill: fill ? fillFor(fill.value, fill.hue) : DEFAULT_FILL,
                      stroke: isSelected ? SELECTED : STROKE,
                      strokeWidth: isSelected ? 1.5 : 0.6,
                      outline: 'none',
                      cursor: onRegionClick ? 'pointer' : 'default',
                    },
                    hover: {
                      fill: fill ? fillFor(Math.min(1, fill.value + 0.15), fill.hue) : '#334155',
                      stroke: SELECTED,
                      strokeWidth: 1,
                      outline: 'none',
                    },
                    pressed: { fill: SELECTED, outline: 'none' },
                  }}
                />
              );
            })
          }
        </Geographies>

        {showLanes && lanes.map((lane) => (
          <Line
            key={lane.id}
            from={lane.from}
            to={lane.to}
            stroke={CARRIER_COLORS[lane.carrier_id] || '#64748b'}
            strokeWidth={0.6}
            strokeOpacity={0.55}
            strokeLinecap="round"
          />
        ))}

        {markers.map((m) => {
          const style = TYPE_STYLE[m.type] || TYPE_STYLE.lastmile;
          const isSelected = selectedMarkerId === m.id;
          const isHighlight = m.tone === 'highlight' || isSelected;
          const isWarning = m.tone === 'warning';
          return (
            <Marker
              key={m.id}
              coordinates={m.coordinates}
              onClick={() => onMarkerClick?.(m.id)}
              style={{
                default: { cursor: onMarkerClick ? 'pointer' : 'default' },
                hover: { cursor: 'pointer' },
                pressed: {},
              } as any}
            >
              {/* Outer ring for highlight */}
              {isHighlight && (
                <circle r={style.r + 4} fill="none" stroke={SELECTED} strokeWidth={1.5} />
              )}
              <circle
                r={style.r}
                fill={isWarning ? '#f43f5e' : style.fill}
                stroke={isWarning ? '#9f1239' : style.ring}
                strokeWidth={1}
              />
              {m.cold && (
                <text textAnchor="middle" y={1.5}
                      style={{ fontSize: '5px', fill: '#0c4a6e', pointerEvents: 'none' }}>
                  ❄
                </text>
              )}
            </Marker>
          );
        })}
      </ComposableMap>
    </div>
  );
}
