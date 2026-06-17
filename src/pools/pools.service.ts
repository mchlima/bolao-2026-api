import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PoolMember, PoolMemberRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MatchRankingResponse,
  RankingResponse,
  RankingsService,
} from '../rankings/rankings.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { CreatePoolDto } from './dto/create-pool.dto';
import { UpdateInviteDto } from './dto/update-invite.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { UpdatePoolDto } from './dto/update-pool.dto';
import {
  JoinPreview,
  PoolDetail,
  PoolInviteView,
  PoolMatchPredictionsView,
  PoolSummary,
} from './pool.types';

const TOURNAMENT_SELECT = {
  id: true,
  name: true,
  logoUrl: true,
  status: true,
} satisfies Prisma.SeasonSelect;

@Injectable()
export class PoolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rankings: RankingsService,
  ) {}

  // ─────────────────────────────────────────────── Pool lifecycle

  async create(userId: string, dto: CreatePoolDto): Promise<PoolDetail> {
    const tournament = await this.prisma.season.findUnique({
      where: { id: dto.seasonId },
      select: { id: true },
    });
    if (!tournament) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Torneio não encontrado.',
      });
    }

    const pool = await this.prisma.pool.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        inviteDescription: dto.inviteDescription ?? null,
        seasonId: dto.seasonId,
        ownerId: userId,
        visibility: dto.visibility ?? 'PRIVATE',
        members: { create: { userId, role: 'OWNER' } },
      },
      select: { id: true },
    });
    return this.detail(pool.id, userId);
  }

  /** Pools the user belongs to, most recently joined first. */
  async listMine(userId: string): Promise<PoolSummary[]> {
    const memberships = await this.prisma.poolMember.findMany({
      where: { userId },
      include: {
        pool: {
          include: {
            season: { select: TOURNAMENT_SELECT },
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    return memberships.map((m) => ({
      id: m.pool.id,
      name: m.pool.name,
      description: m.pool.description,
      inviteDescription: m.pool.inviteDescription,
      visibility: m.pool.visibility,
      tournament: m.pool.season,
      myRole: m.role,
      memberCount: m.pool._count.members,
      createdAt: m.pool.createdAt,
    }));
  }

  async detail(poolId: string, userId: string): Promise<PoolDetail> {
    const membership = await this.requireMembership(poolId, userId);

    const pool = await this.prisma.pool.findUnique({
      where: { id: poolId },
      include: {
        season: { select: TOURNAMENT_SELECT },
        members: {
          include: {
            user: { select: { id: true, name: true, avatarUrl: true } },
          },
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        },
        _count: { select: { members: true } },
      },
    });
    if (!pool) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Bolão não encontrado.',
      });
    }

    const canManage = this.canManage(membership.role);
    const invites = canManage
      ? await this.prisma.poolInvite.findMany({
          where: { poolId },
          orderBy: { createdAt: 'desc' },
        })
      : undefined;

    return {
      id: pool.id,
      name: pool.name,
      description: pool.description,
      inviteDescription: pool.inviteDescription,
      visibility: pool.visibility,
      tournament: pool.season,
      myRole: membership.role,
      memberCount: pool._count.members,
      createdAt: pool.createdAt,
      members: pool.members.map((m) => ({
        user: m.user,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
      ...(invites && { invites: invites.map((i) => this.toInviteView(i)) }),
    };
  }

  async update(
    poolId: string,
    userId: string,
    dto: UpdatePoolDto,
  ): Promise<PoolDetail> {
    await this.requireManage(poolId, userId);
    await this.prisma.pool.update({
      where: { id: poolId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.inviteDescription !== undefined && {
          inviteDescription: dto.inviteDescription,
        }),
        ...(dto.visibility !== undefined && { visibility: dto.visibility }),
      },
    });
    return this.detail(poolId, userId);
  }

  /** Delete the pool (cascades members + invites). Owner only. */
  async remove(poolId: string, userId: string): Promise<void> {
    await this.requireOwner(poolId, userId);
    await this.prisma.pool.delete({ where: { id: poolId } });
  }

  async transferOwnership(
    poolId: string,
    userId: string,
    targetUserId: string,
  ): Promise<PoolDetail> {
    await this.requireOwner(poolId, userId);
    if (targetUserId === userId) {
      throw new BadRequestException({
        code: 'ALREADY_OWNER',
        message: 'Você já é o dono do bolão.',
      });
    }
    const target = await this.findMember(poolId, targetUserId);

    // New owner is promoted; the old owner steps down to admin.
    await this.prisma.$transaction([
      this.prisma.poolMember.update({
        where: { id: target.id },
        data: { role: 'OWNER' },
      }),
      this.prisma.poolMember.update({
        where: { poolId_userId: { poolId, userId } },
        data: { role: 'ADMIN' },
      }),
      this.prisma.pool.update({
        where: { id: poolId },
        data: { ownerId: targetUserId },
      }),
    ]);
    return this.detail(poolId, userId);
  }

  // ─────────────────────────────────────────────── Invite links

  async createInvite(
    poolId: string,
    userId: string,
    dto: CreateInviteDto,
  ): Promise<PoolInviteView> {
    await this.requireManage(poolId, userId);

    // Retry on the (astronomically rare) code collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const invite = await this.prisma.poolInvite.create({
          data: {
            poolId,
            name: dto.name,
            code: this.generateCode(),
            createdById: userId,
          },
        });
        return this.toInviteView(invite);
      } catch (e) {
        if (this.isUniqueViolation(e)) continue;
        throw e;
      }
    }
    throw new BadRequestException({
      code: 'CODE_GENERATION_FAILED',
      message: 'Não foi possível gerar o link. Tente de novo.',
    });
  }

  async listInvites(
    poolId: string,
    userId: string,
  ): Promise<PoolInviteView[]> {
    await this.requireManage(poolId, userId);
    const invites = await this.prisma.poolInvite.findMany({
      where: { poolId },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((i) => this.toInviteView(i));
  }

  async updateInvite(
    poolId: string,
    userId: string,
    inviteId: string,
    dto: UpdateInviteDto,
  ): Promise<PoolInviteView> {
    await this.requireManage(poolId, userId);
    const invite = await this.prisma.poolInvite.findUnique({
      where: { id: inviteId },
    });
    if (!invite || invite.poolId !== poolId) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Link de convite não encontrado.',
      });
    }
    const updated = await this.prisma.poolInvite.update({
      where: { id: inviteId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    return this.toInviteView(updated);
  }

  async deleteInvite(
    poolId: string,
    userId: string,
    inviteId: string,
  ): Promise<void> {
    await this.requireManage(poolId, userId);
    const invite = await this.prisma.poolInvite.findUnique({
      where: { id: inviteId },
      select: { id: true, poolId: true },
    });
    if (!invite || invite.poolId !== poolId) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Link de convite não encontrado.',
      });
    }
    await this.prisma.poolInvite.delete({ where: { id: inviteId } });
  }

  // ─────────────────────────────────────────────── Joining

  /** What an invite code points to — for a confirm screen before joining. */
  async joinPreview(code: string, userId: string): Promise<JoinPreview> {
    const invite = await this.prisma.poolInvite.findUnique({
      where: { code },
      include: {
        pool: {
          include: {
            season: { select: TOURNAMENT_SELECT },
            _count: { select: { members: true } },
          },
        },
      },
    });
    if (!invite || !invite.isActive) {
      throw new NotFoundException({
        code: 'INVITE_INVALID',
        message: 'Link de convite inválido ou expirado.',
      });
    }
    const already = await this.prisma.poolMember.findUnique({
      where: { poolId_userId: { poolId: invite.poolId, userId } },
      select: { id: true },
    });
    return {
      id: invite.pool.id,
      name: invite.pool.name,
      // The invite page shows the invite-facing text, not the internal one.
      description: invite.pool.inviteDescription,
      visibility: invite.pool.visibility,
      tournament: invite.pool.season,
      memberCount: invite.pool._count.members,
      alreadyMember: !!already,
    };
  }

  /** Join via an invite code. Idempotent — re-joining is a no-op. */
  async join(code: string, userId: string): Promise<PoolDetail> {
    const invite = await this.prisma.poolInvite.findUnique({
      where: { code },
      select: { poolId: true, isActive: true },
    });
    if (!invite || !invite.isActive) {
      throw new NotFoundException({
        code: 'INVITE_INVALID',
        message: 'Link de convite inválido ou expirado.',
      });
    }
    await this.prisma.poolMember.upsert({
      where: { poolId_userId: { poolId: invite.poolId, userId } },
      update: {},
      create: { poolId: invite.poolId, userId, role: 'MEMBER' },
    });
    return this.detail(invite.poolId, userId);
  }

  // ─────────────────────────────────────────────── Members

  async updateMemberRole(
    poolId: string,
    userId: string,
    targetUserId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<PoolDetail> {
    await this.requireOwner(poolId, userId);
    if (dto.role === 'OWNER') {
      throw new BadRequestException({
        code: 'USE_TRANSFER',
        message: 'Para passar a posse, use a transferência de dono.',
      });
    }
    if (targetUserId === userId) {
      throw new BadRequestException({
        code: 'CANNOT_CHANGE_OWN_ROLE',
        message: 'O dono não pode alterar o próprio papel.',
      });
    }
    const target = await this.findMember(poolId, targetUserId);
    if (target.role === 'OWNER') {
      throw new BadRequestException({
        code: 'CANNOT_CHANGE_OWNER',
        message: 'Não é possível alterar o papel do dono.',
      });
    }
    await this.prisma.poolMember.update({
      where: { id: target.id },
      data: { role: dto.role },
    });
    return this.detail(poolId, userId);
  }

  async removeMember(
    poolId: string,
    userId: string,
    targetUserId: string,
  ): Promise<void> {
    const me = await this.requireMembership(poolId, userId);
    if (!this.canManage(me.role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Apenas dono ou admin podem remover membros.',
      });
    }
    if (targetUserId === userId) {
      throw new BadRequestException({
        code: 'USE_LEAVE',
        message: 'Para sair do bolão, use a opção de sair.',
      });
    }
    const target = await this.findMember(poolId, targetUserId);
    if (target.role === 'OWNER') {
      throw new BadRequestException({
        code: 'CANNOT_REMOVE_OWNER',
        message: 'Não é possível remover o dono do bolão.',
      });
    }
    // Admins can remove plain members only; demoting/removing an admin is the
    // owner's call.
    if (target.role === 'ADMIN' && me.role !== 'OWNER') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Apenas o dono pode remover um admin.',
      });
    }
    await this.prisma.poolMember.delete({ where: { id: target.id } });
  }

  /** The current user leaves the pool. The owner must transfer or delete. */
  async leave(poolId: string, userId: string): Promise<void> {
    const me = await this.requireMembership(poolId, userId);
    if (me.role === 'OWNER') {
      throw new ForbiddenException({
        code: 'OWNER_CANNOT_LEAVE',
        message: 'O dono precisa transferir a posse ou excluir o bolão.',
      });
    }
    await this.prisma.poolMember.delete({ where: { id: me.id } });
  }

  // ─────────────────────────────────────────────── Scoped rankings

  async tournamentRanking(
    poolId: string,
    userId: string,
  ): Promise<RankingResponse> {
    await this.requireMembership(poolId, userId);
    const pool = await this.prisma.pool.findUnique({
      where: { id: poolId },
      select: { seasonId: true },
    });
    if (!pool) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Bolão não encontrado.',
      });
    }
    const memberIds = await this.memberUserIds(poolId);
    return this.rankings.tournamentRanking(pool.seasonId, userId, memberIds);
  }

  async matchRanking(
    poolId: string,
    matchId: string,
    userId: string,
  ): Promise<MatchRankingResponse> {
    await this.requireMembership(poolId, userId);
    const memberIds = await this.memberUserIds(poolId);
    return this.rankings.matchRanking(matchId, userId, memberIds);
  }

  /**
   * Each member's prediction for one match. PRIVACY: until kickoff, only the
   * requester's own prediction is returned (`revealed: false`) — nobody peeks
   * at others' guesses before the match starts. Enforced here, not just in UI.
   */
  async matchPredictions(
    poolId: string,
    matchId: string,
    userId: string,
  ): Promise<PoolMatchPredictionsView> {
    await this.requireMembership(poolId, userId);
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, kickoffAt: true, status: true },
    });
    if (!match) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Partida não encontrada.',
      });
    }

    // Revealed once the match starts: kickoff passed, or it's no longer SCHEDULED.
    const revealed =
      new Date() >= match.kickoffAt || match.status !== 'SCHEDULED';

    if (revealed) {
      const memberIds = await this.memberUserIds(poolId);
      const ranking = await this.rankings.matchRanking(
        matchId,
        userId,
        memberIds,
      );
      return {
        revealed: true,
        entries: ranking.entries
          .filter((e) => e.prediction)
          .map((e) => ({
            user: e.user,
            prediction: e.prediction!,
            points: e.points,
            tier: e.tier,
          })),
      };
    }

    // Hidden: only the requester's own prediction (if any).
    const own = await this.prisma.prediction.findUnique({
      where: { userId_matchId: { userId, matchId } },
      select: {
        homeScore: true,
        awayScore: true,
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
    return {
      revealed: false,
      entries: own
        ? [
            {
              user: own.user,
              prediction: { home: own.homeScore, away: own.awayScore },
            },
          ]
        : [],
    };
  }

  // ─────────────────────────────────────────────── Internals

  private async requireMembership(
    poolId: string,
    userId: string,
  ): Promise<PoolMember> {
    const membership = await this.prisma.poolMember.findUnique({
      where: { poolId_userId: { poolId, userId } },
    });
    if (!membership) {
      const exists = await this.prisma.pool.findUnique({
        where: { id: poolId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Bolão não encontrado.',
        });
      }
      throw new ForbiddenException({
        code: 'NOT_MEMBER',
        message: 'Você não participa deste bolão.',
      });
    }
    return membership;
  }

  private async requireManage(
    poolId: string,
    userId: string,
  ): Promise<PoolMember> {
    const membership = await this.requireMembership(poolId, userId);
    if (!this.canManage(membership.role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Apenas dono ou admin podem fazer isso.',
      });
    }
    return membership;
  }

  private async requireOwner(
    poolId: string,
    userId: string,
  ): Promise<PoolMember> {
    const membership = await this.requireMembership(poolId, userId);
    if (membership.role !== 'OWNER') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Apenas o dono pode fazer isso.',
      });
    }
    return membership;
  }

  private async findMember(
    poolId: string,
    targetUserId: string,
  ): Promise<PoolMember> {
    const member = await this.prisma.poolMember.findUnique({
      where: { poolId_userId: { poolId, userId: targetUserId } },
    });
    if (!member) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Membro não encontrado neste bolão.',
      });
    }
    return member;
  }

  private async memberUserIds(poolId: string): Promise<string[]> {
    const members = await this.prisma.poolMember.findMany({
      where: { poolId },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  private canManage(role: PoolMemberRole): boolean {
    return role === 'OWNER' || role === 'ADMIN';
  }

  private generateCode(): string {
    // 8-char url-safe token (48 bits) — used in the join URL.
    return randomBytes(6).toString('base64url');
  }

  private isUniqueViolation(e: unknown): boolean {
    return (
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    );
  }

  private toInviteView(invite: {
    id: string;
    name: string;
    code: string;
    isActive: boolean;
    createdAt: Date;
  }): PoolInviteView {
    return {
      id: invite.id,
      name: invite.name,
      code: invite.code,
      isActive: invite.isActive,
      createdAt: invite.createdAt,
    };
  }
}
