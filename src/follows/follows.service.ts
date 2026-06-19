import { Injectable, NotFoundException } from '@nestjs/common';
import { Team } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Teams a user follows to get a match reminder ~1h before kickoff. The follow set
 * is also read by the notifications reminder job to fan a match out to followers.
 */
@Injectable()
export class FollowsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The user's followed teams, full objects, alphabetical. */
  async list(userId: string): Promise<Team[]> {
    const rows = await this.prisma.followedTeam.findMany({
      where: { userId },
      include: { team: true },
      orderBy: { team: { name: 'asc' } },
    });
    return rows.map((r) => r.team);
  }

  /** Idempotent — following an already-followed team is a no-op. */
  async follow(userId: string, teamId: string): Promise<void> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Time não encontrado.' });
    }
    await this.prisma.followedTeam.upsert({
      where: { userId_teamId: { userId, teamId } },
      create: { userId, teamId },
      update: {},
    });
  }

  async unfollow(userId: string, teamId: string): Promise<void> {
    await this.prisma.followedTeam.deleteMany({ where: { userId, teamId } });
  }
}
