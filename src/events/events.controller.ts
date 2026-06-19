import { Controller, Query, Sse } from '@nestjs/common';
import { Observable, interval, merge } from 'rxjs';
import { finalize, map } from 'rxjs/operators';
import { EventsService } from './events.service';

/** Public SSE stream. Clients pass the rooms they care about, e.g.
 * GET /api/events?rooms=tournament:abc,match:def — and refetch on any event.
 * A 30s heartbeat keeps the connection alive through Cloudflare's idle timeout. */
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Sse()
  stream(@Query('rooms') rooms?: string): Observable<{ data: unknown }> {
    const list = (rooms ?? '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    // Endpoint stays anonymous (logged-out clients work unchanged). We identify
    // who's connected best-effort from the `user:<id>` room the front already
    // sends; everyone else just counts toward the total.
    const userId = list.find((r) => r.startsWith('user:'))?.slice(5) || null;
    const connId = this.events.addConnection(userId);
    const data$ = this.events.stream(list).pipe(map((e) => ({ data: e })));
    const ping$ = interval(30000).pipe(map(() => ({ data: { ping: true } })));
    return merge(data$, ping$).pipe(
      finalize(() => this.events.removeConnection(connId)),
    );
  }
}
