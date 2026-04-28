# web/CLAUDE.md — Next.js 14 frontend

## Role

Scenario UIs (A–G), knowledge-graph object explorer, ontology meta views, operations console. App Router + standalone build for ECS Fargate ARM64. Auth is enforced upstream by Lambda@Edge — pages assume `id_token` cookie is already present and valid.

## Layout

- `app/(shopper)/` — route group for shopper-facing scenarios (search, chat, price).
- `app/(md)/` — route group for MD-facing scenarios (insights).
- `app/match/`, `app/safety/`, `app/substitute/`, `app/price/` — top-level scenario routes.
- `app/objects/[type]/` — dynamic Knowledge Graph object explorer (14 types: product, ingredient, concern, trend, brand, category, persona, channel, manufacturer, review, region, warehouse, carrier, event, inventory, shipment).
- `app/ops/[area]/` — dynamic operations console (ingest, guardrail, memory, eval, trace).
- `app/{schema,standards,validation}/` — ontology meta views.
- `app/logistics/page.tsx` — Scenario H: Korean choropleth map + KPI strip + tabbed right panel (거점·운송사 / 물류 도우미).
- `components/` — shared widgets: `Sidebar`, `SidebarAuth`, `PersonaSwitch`, `GuidedTour`, `CytoscapeView`, `LogisticsChatPanel`.
- `components/map/KoreaMapView.tsx` — react-simple-maps + d3-geo wrapper, consumes `public/korea-provinces.json` (KOSTAT 17-sido, 146 KB) with 5:4 viewBox.
- `lib/api-client.ts` — typed REST + SSE client. Single file; one function per endpoint.
- `lib/persona-context.tsx` — global active-persona React Context backed by localStorage.

## Conventions

- **Page outer shell**: every scenario page uses `min-h-screen flex flex-col` + `header.h-14` + `flex-1 px-6 py-6 max-w-[1500px] mx-auto w-full flex flex-col gap-5`. Order is title → form → chips → workspace.
- **Color identity per scenario**: A=accent (blue), B=emerald, C=amber, D=violet, E=rose, F=cyan-substitute, G=cyan. Don't unify — they're navigation aids.
- **Card shading hierarchy**: page = `bg-ink-950`, panel = `bg-ink-900`, card = `bg-ink-800`, sub-card = `bg-ink-900` (one step darker than its parent card).
- **Markdown rendering**: chat and insights answers go through `react-markdown` v10 + `remark-gfm` under `.chat-markdown` styles in `globals.css`.
- **SSE consumption**: use `api.streamSSE<T>` or scenario-specific wrappers (`api.searchStream`, `api.insightsStream`, `api.chatStream`).
- **Persona injection**: pages that depend on the active persona call `useActivePersona()` and pass `persona: activePersona?.id` to API calls (search, chat, price).
- **Sample chip activation**: `onClick={() => { setQ(s); runSearch(s); }}` — pass the value to the runner directly rather than relying on state-set-then-call.

## Adding a new scenario

1. Create `app/<slug>/page.tsx` with `'use client'` directive.
2. Mirror the search/insights skeleton: header → title → form → chips → result panel.
3. Pick a unique color for the scenario (Tailwind palette).
4. Add the API client function in `lib/api-client.ts` with full TypeScript types.
5. Add a sidebar entry in `components/Sidebar.tsx` under `시나리오` with the next badge letter.
6. Add a step to `components/GuidedTour.tsx`'s `STEPS` array.

## TypeScript validation

```bash
cd web && npx tsc --noEmit
```

Always run before pushing — the Docker build does the same and a failure breaks deploy.
