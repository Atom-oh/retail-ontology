import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Cache-Control middleware.
 *
 * Default Next.js sends `s-maxage=31536000, stale-while-revalidate` for
 * statically-rendered app-router pages. That makes browsers/CDN cache the
 * HTML for a year — which means after a deploy ships new chunk hashes,
 * users with cached HTML still reference DELETED `_next/static/chunks/...`
 * paths, and Next.js client-side navigation throws "An error was
 * encountered with the requested page" on chunk-fetch 404.
 *
 * We force `no-store` for everything except `/_next/static/*` (which is
 * content-addressed and safe to cache forever). Middleware runs on every
 * request, so this overrides whatever Next.js's renderer set.
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const path = req.nextUrl.pathname;

  if (path.startsWith('/_next/static/')) {
    res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.headers.set('Cache-Control', 'no-store, must-revalidate');
  }
  return res;
}

export const config = {
  // Run on every path except _next/image and favicon (Next.js internals).
  // _next/static IS included so we can apply the long-cache header above.
  matcher: ['/((?!_next/image|favicon.ico).*)'],
};
