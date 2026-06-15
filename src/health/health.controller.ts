import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// How long the DB probe may take before /health gives up on it. Kept short so
// the endpoint always answers fast — a DB blip must never make /health hang
// (which would 522 at the edge and flap the Docker healthcheck into a restart
// that can't fix an upstream/Supabase outage anyway).
const DB_PROBE_MS = 2000;

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // Liveness: always 200 fast. `db` is a best-effort readiness signal that the
  // process is talking to Postgres — never blocks the response.
  @Get()
  async check(): Promise<{ status: string; db: string }> {
    let db = 'up';
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('db probe timeout')), DB_PROBE_MS),
        ),
      ]);
    } catch {
      db = 'down';
    }
    return { status: 'ok', db };
  }
}
