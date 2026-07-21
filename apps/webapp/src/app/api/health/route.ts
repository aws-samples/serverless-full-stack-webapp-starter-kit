/**
 * GET /api/health
 * Readiness endpoint for Lambda Web Adapter (AWS_LWA_READINESS_CHECK_PATH).
 *
 * Reports only whether the Next.js server has started and can accept HTTP.
 * Do NOT check downstream dependencies (DB, auth, external APIs) here: a
 * transiently slow or unhealthy dependency would fail readiness and make LWA
 * treat a healthy process as invalid, causing needless restart loops. For this
 * reason, do not import DB clients or auth libraries in this file.
 */
export function GET() {
  return new Response('ok', {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
