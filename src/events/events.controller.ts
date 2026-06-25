import { Controller, Query, Req, Sse } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { Observable, interval, merge } from 'rxjs';
import { finalize, map } from 'rxjs/operators';
import { EventsService } from './events.service';

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name)
      return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** Public SSE stream. Clients pass the rooms they care about, e.g.
 * GET /api/events?rooms=tournament:abc,match:def — and refetch on any event.
 * A 30s heartbeat keeps the connection alive through Cloudflare's idle timeout. */
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly jwt: JwtService,
  ) {}

  @Sse()
  stream(
    @Req() req: Request,
    @Query('rooms') rooms?: string,
    @Query('did') did?: string,
  ): Observable<{ data: unknown }> {
    const list = (rooms ?? '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    // Endpoint stays anonymous: logged-out clients work unchanged. Identify the
    // user from the `bolao-token` cookie when present (verified — EventSource
    // can't send an auth header, so we read the cookie), and fall back to the
    // `user:<id>` room the front sends (best-effort) so identification doesn't
    // regress for clients without the cross-subdomain cookie yet.
    let userId: string | null = null;
    const token = readCookie(req, 'bolao-token');
    if (token) {
      try {
        userId = this.jwt.verify<{ sub: string }>(token).sub;
      } catch {
        /* missing/invalid/expired → stay anonymous (or use the fallback below) */
      }
    }
    if (!userId)
      userId = list.find((r) => r.startsWith('user:'))?.slice(5) || null;
    const connId = this.events.addConnection(userId, did?.trim() || null, list);
    const data$ = this.events.stream(list).pipe(map((e) => ({ data: e })));
    const ping$ = interval(30000).pipe(map(() => ({ data: { ping: true } })));
    return merge(data$, ping$).pipe(
      finalize(() => this.events.removeConnection(connId)),
    );
  }
}
