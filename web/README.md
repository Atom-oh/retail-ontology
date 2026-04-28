# Phase 4 — Next.js 14 frontend

Implements scenarios A/B/C UI (spec § 4) on App Router + Tailwind + Cytoscape.js.

```
web/
├── app/
│   ├── layout.tsx              # Root: Pretendard font, Tailwind base
│   ├── page.tsx                # Persona selector landing
│   ├── globals.css
│   ├── api/
│   │   └── health-web/route.ts # ALB tg-web health check (200 ok)
│   ├── (shopper)/
│   │   ├── layout.tsx          # Shopper top-bar (Search · Chat)
│   │   ├── search/page.tsx     # Scenario A
│   │   └── chat/page.tsx       # Scenario B (SSE consumer)
│   └── (md)/
│       ├── layout.tsx          # MD top-bar (Insights)
│       └── insights/page.tsx   # Scenario C
├── components/
│   └── graph/CytoscapeView.tsx # Cytoscape wrapper, ontology stylesheet
├── lib/
│   └── api-client.ts           # fetch wrappers for /api/{search,chat,insights}
├── public/                     # static assets (fonts mounted at runtime)
├── Dockerfile                  # ARM64 Next.js standalone
├── next.config.mjs             # output: 'standalone'
├── tailwind.config.ts
├── postcss.config.js
├── tsconfig.json
└── package.json                # next 14.2, react 18.3, cytoscape 3.30
```

## Local dev

```bash
cd web
npm install

# Pretendard variable font (one-time):
mkdir -p public/fonts
curl -L -o public/fonts/pretendard-variable.woff2 \
  https://github.com/orioncactus/pretendard/raw/main/packages/pretendard/dist/web/variable/pretendardvariable.woff2

# Point dev to local FastAPI (Phase 3) for /api/* calls
echo 'NEXT_PUBLIC_API_BASE_URL=http://localhost:8000' > .env.local

npm run dev
# → http://localhost:3000
```

## Build & push to ECR

```bash
ACCOUNT=<account-id>
REGION=ap-northeast-2
REPO=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/ontology-retail-dev-web

aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com

docker buildx build --platform linux/arm64 \
  -t $REPO:latest \
  -f web/Dockerfile \
  --push .

aws ecs update-service --cluster ontology-retail-dev-cluster \
  --service ontology-retail-dev-web --force-new-deployment --region $REGION
```

## Routing notes

- ALB listener (compute-stack § 5.3) routes `/api/*` → `tg-api` (FastAPI)
  and everything else → `tg-web` (Next.js).
- ALB health check for `tg-web` uses `/api/health-web` — bypasses listener
  rules, hits target IPs directly. So `app/api/health-web/route.ts` is
  reachable for health checks even though browser `/api/*` goes to FastAPI.
- Cognito OAuth callback path (`/api/auth/callback`) is owned by FastAPI in
  the deployed topology. (Spec § 6.1 lists it under web/, but actual
  routing routes /api/* to tg-api. Auth wiring deferred to next session.)

## Pretendard font

The font is loaded via `next/font/local` from `public/fonts/pretendard-variable.woff2`.
The file is gitignored (binary, ~700KB) — fetch with the curl command above.
For production Docker build, place the .woff2 file in `web/public/fonts/`
before `docker build` (or download in Dockerfile).

## Cytoscape stylesheet

Node colors per ontology label (spec § 8.1 core classes):
- `Product` (round-rectangle) — brand blue
- `Ingredient` (ellipse) — emerald
- `Concern` (diamond) — amber
- `Brand` (hexagon) — purple
- `.wow` class — orange highlight for top-3 hits in scenario A

Phase 5 wow rehearsal: feed `wowNodeIds` prop with the `psn_001..psn_005`
matched SKUs to over-tune visual emphasis on demo queries.
