import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { classifyLine, EspnLineupTeam } from '../live-ingest/espn.service';

export interface MatchLineup {
  available: boolean;
  reason?: 'pending'; // not ingested yet (no lineup persisted)
  home?: EspnLineupTeam;
  away?: EspnLineupTeam;
}

const UNAVAILABLE: MatchLineup = { available: false, reason: 'pending' };

/**
 * Serves a match lineup from OUR database — the robot's MatchSummaryService
 * persists it (lineup entries + formations), so the front never touches ESPN.
 * Names and photos are read off the related Player (idiomatic apelido for the
 * Brasileirão). Empty until the robot has ingested (≈1h before kickoff).
 */
@Injectable()
export class LineupService {
  constructor(private readonly prisma: PrismaService) {}

  async forMatch(id: string): Promise<MatchLineup> {
    const match = await this.prisma.match.findUnique({
      where: { id },
      select: {
        homeTeamId: true,
        awayTeamId: true,
        homeFormation: true,
        awayFormation: true,
        lineupEntries: {
          select: {
            teamId: true,
            isStarter: true,
            jersey: true,
            position: true,
            formationPlace: true,
            subbedIn: true,
            subbedOut: true,
            yellow: true,
            red: true,
            player: { select: { name: true, photoUrl: true } },
            subFor: { select: { name: true } },
          },
        },
      },
    });
    if (!match) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Partida não encontrada.' });
    }
    if (!match.lineupEntries.length) return UNAVAILABLE;

    const side = (teamId: string | null, formation: string | null): EspnLineupTeam => ({
      homeAway: teamId === match.homeTeamId ? 'home' : 'away',
      formation,
      players: match.lineupEntries
        .filter((e) => e.teamId === teamId)
        .map((e) => ({
          espnId: null,
          subForEspnId: null,
          name: e.player.name,
          jersey: e.jersey,
          position: e.position,
          line: classifyLine(e.position),
          formationPlace: e.formationPlace,
          starter: e.isStarter,
          subbedIn: e.subbedIn,
          subbedOut: e.subbedOut,
          yellow: e.yellow,
          red: e.red,
          photo: e.player.photoUrl,
          subFor: e.subFor?.name ?? null,
          subMinute: null,
        })),
    });

    return {
      available: true,
      home: side(match.homeTeamId, match.homeFormation),
      away: side(match.awayTeamId, match.awayFormation),
    };
  }
}
