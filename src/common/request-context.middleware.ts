import type { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from './request-context';

function header(req: Request, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

// Cloudflare sends cf-ipcity / cf-region as raw UTF-8, but Node parses header
// values as latin1 — so "São Paulo" arrives mangled as "SÃ£o Paulo". Reinterpret
// the bytes as UTF-8 to recover the accented name (no-op for pure ASCII).
function fromUtf8Header(s: string | null): string | null {
  if (!s) return null;
  return Buffer.from(s, 'latin1').toString('utf8');
}

/**
 * Plain Express middleware (registered via app.use in main.ts, so it sidesteps
 * Nest's path matcher). Opens an AsyncLocalStorage scope for the request with the
 * client IP + geo resolved from Cloudflare headers, falling back gracefully when
 * not behind the proxy (local dev). country is always present behind CF; city and
 * region only when the "Add visitor location headers" managed transform is on.
 */
export function requestContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const forwarded = header(req, 'x-forwarded-for');
  const ip =
    header(req, 'cf-connecting-ip') ??
    (forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : null) ??
    req.ip ??
    null;

  runWithRequestContext(
    {
      ip,
      userAgent: header(req, 'user-agent'),
      country: header(req, 'cf-ipcountry'),
      region: fromUtf8Header(header(req, 'cf-region')),
      city: fromUtf8Header(header(req, 'cf-ipcity')),
    },
    () => next(),
  );
}
