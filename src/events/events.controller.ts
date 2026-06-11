import { Controller, Query, Sse } from '@nestjs/common';
import { Observable, interval, merge } from 'rxjs';
import { map } from 'rxjs/operators';
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
    const data$ = this.events.stream(list).pipe(map((e) => ({ data: e })));
    const ping$ = interval(30000).pipe(map(() => ({ data: { ping: true } })));
    return merge(data$, ping$);
  }
}
