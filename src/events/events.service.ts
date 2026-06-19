import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { filter } from 'rxjs/operators';

export interface RealtimeEvent {
  room: string;
}

interface Connection {
  userId: string | null; // from the front's `user:<id>` room; trusted best-effort
  since: Date;
}

export interface Presence {
  total: number; // every open stream, logged-in or anonymous
  users: { userId: string; connections: number; since: Date }[];
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

  // Live SSE connections, for presence ("quem está online"). In-memory only:
  // a restart resets it, which is correct — there are no live streams after one.
  private readonly connections = new Map<number, Connection>();
  private nextConnId = 1;

  /** Register an open SSE stream; returns an id to release it on disconnect. */
  addConnection(userId: string | null): number {
    const id = this.nextConnId++;
    this.connections.set(id, { userId, since: new Date() });
    return id;
  }

  removeConnection(id: number): void {
    this.connections.delete(id);
  }

  /** Snapshot of who's connected: total count + per-identified-user breakdown. */
  presence(): Presence {
    const byUser = new Map<string, { connections: number; since: Date }>();
    for (const c of this.connections.values()) {
      if (!c.userId) continue;
      const e = byUser.get(c.userId);
      if (e) {
        e.connections += 1;
        if (c.since < e.since) e.since = c.since;
      } else {
        byUser.set(c.userId, { connections: 1, since: c.since });
      }
    }
    return {
      total: this.connections.size,
      users: [...byUser].map(([userId, v]) => ({ userId, ...v })),
    };
  }

  emit(...rooms: string[]): void {
    for (const r of rooms) if (r) this.pending.add(r);
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.pending.size === 0) {
        // Idle: stop the timer; the next emit() starts a fresh one.
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        return;
      }
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
