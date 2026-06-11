import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { filter } from 'rxjs/operators';

export interface RealtimeEvent {
  room: string;
}

/**
 * In-process realtime bus for SSE. Mutations (ESPN robot, admin match edits,
 * prediction upserts) call emit(); connected clients in the room refetch.
 * Emissions are COALESCED to at most one per room per ~2s so a burst (e.g. the
 * robot updating several matches) doesn't fan out into a refetch storm.
 */
@Injectable()
export class EventsService {
  private readonly subject = new Subject<RealtimeEvent>();
  private readonly pending = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  emit(...rooms: string[]): void {
    for (const r of rooms) if (r) this.pending.add(r);
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.pending.size === 0) return;
      for (const room of this.pending) this.subject.next({ room });
      this.pending.clear();
    }, 2000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stream(rooms: string[]): Observable<RealtimeEvent> {
    const set = new Set(rooms);
    return this.subject.asObservable().pipe(filter((e) => set.has(e.room)));
  }
}
