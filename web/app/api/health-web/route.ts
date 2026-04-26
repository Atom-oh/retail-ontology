// ALB tg-web target group health check (compute-stack § 5.3).
// Note: ALB listener routes /api/* → tg-api. ALB health checks bypass listener
// rules and hit the target IP directly, so this endpoint is reachable for
// health checks even though browser /api/* requests go to FastAPI.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET() {
  return new Response(JSON.stringify({ status: 'ok', service: 'web' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
