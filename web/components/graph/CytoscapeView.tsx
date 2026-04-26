'use client';

import cytoscape from 'cytoscape';
import { useEffect, useMemo, useRef } from 'react';

import type { Subgraph } from '@/lib/api-client';

const ONTOLOGY_STYLE: cytoscape.StylesheetStyle[] = [
  {
    selector: 'node',
    style: {
      label: 'data(name_ko)',
      'text-valign': 'center',
      'text-halign': 'center',
      'text-wrap': 'wrap',
      'text-max-width': '88',
      'background-color': '#3b5bdb',
      color: '#ffffff',
      'font-family': 'Pretendard, sans-serif',
      'font-size': 11,
      width: 36,
      height: 36,
      'border-width': 2,
      'border-color': '#1a2447',
    },
  },
  {
    selector: 'node[label = "Product"]',
    style: { 'background-color': '#2f49b2', shape: 'round-rectangle' },
  },
  {
    selector: 'node[label = "Ingredient"]',
    style: { 'background-color': '#10b981', shape: 'ellipse' },
  },
  {
    selector: 'node[label = "Concern"]',
    style: { 'background-color': '#f59e0b', shape: 'diamond' },
  },
  {
    selector: 'node[label = "Brand"]',
    style: { 'background-color': '#a855f7', shape: 'hexagon' },
  },
  {
    selector: 'edge',
    style: {
      width: 1.5,
      'line-color': '#94a3b8',
      'target-arrow-color': '#94a3b8',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      label: 'data(label)',
      'font-size': 9,
      'text-rotation': 'autorotate' as cytoscape.Css.PropertyValueEdge<'autorotate'>,
      'text-background-color': '#ffffff',
      'text-background-opacity': 0.8,
      'text-background-padding': '2',
    },
  },
  {
    selector: '.wow',
    style: {
      'background-color': '#ff6b35',
      'line-color': '#ff6b35',
      'target-arrow-color': '#ff6b35',
      width: 3,
    },
  },
];

export function CytoscapeView({
  subgraph, wowNodeIds = [], height = 400,
}: {
  subgraph: Subgraph;
  wowNodeIds?: string[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const elements = useMemo(() => [
    ...subgraph.nodes.map((n) => ({ ...n, group: 'nodes' as const })),
    ...subgraph.edges.map((e) => ({ ...e, group: 'edges' as const })),
  ], [subgraph]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!cyRef.current) {
      cyRef.current = cytoscape({
        container: containerRef.current,
        elements,
        style: ONTOLOGY_STYLE,
        layout: { name: 'cose', animate: true, fit: true, padding: 24 },
        minZoom: 0.4, maxZoom: 2.5,
        wheelSensitivity: 0.2,
      });
    } else {
      cyRef.current.elements().remove();
      cyRef.current.add(elements);
      cyRef.current.layout({ name: 'cose', animate: true, fit: true, padding: 24 }).run();
    }
    if (wowNodeIds.length && cyRef.current) {
      cyRef.current.batch(() => {
        cyRef.current!.elements().removeClass('wow');
        for (const id of wowNodeIds) {
          const node = cyRef.current!.getElementById(id);
          if (node.length) {
            node.addClass('wow');
            node.connectedEdges().addClass('wow');
          }
        }
      });
    }
  }, [elements, wowNodeIds]);

  useEffect(() => () => {
    cyRef.current?.destroy();
    cyRef.current = null;
  }, []);

  if (!subgraph.nodes.length) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-slate-400"
        style={{ height }}
      >
        검색 결과 그래프가 없습니다.
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
      style={{ height, width: '100%' }}
    />
  );
}
