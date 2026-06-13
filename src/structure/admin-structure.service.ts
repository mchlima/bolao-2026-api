import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SlotResolverService } from './slot-resolver.service';
import {
  CreateGroupDto,
  CreateRoundDto,
  CreateStageDto,
  CreateTieDto,
  SetGroupTeamsDto,
  UpdateGroupDto,
  UpdateRoundDto,
  UpdateStageDto,
  UpdateTieDto,
} from './dto/structure-admin.dto';

// Map a nullable JSON DTO field to Prisma's input (undefined = leave, null = clear).
function jsonInput(
  v: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (v === undefined) return undefined;
  if (v === null) return Prisma.JsonNull;
  return v as Prisma.InputJsonValue;
}

@Injectable()
export class AdminStructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: SlotResolverService,
  ) {}

  // ── Stage ──
  createStage(dto: CreateStageDto) {
    return this.prisma.stage.create({ data: dto });
  }
  updateStage(id: string, dto: UpdateStageDto) {
    return this.prisma.stage.update({ where: { id }, data: dto });
  }
  deleteStage(id: string) {
    return this.prisma.stage.delete({ where: { id } });
  }

  // ── Group ──
  createGroup(dto: CreateGroupDto) {
    return this.prisma.group.create({ data: dto });
  }
  updateGroup(id: string, dto: UpdateGroupDto) {
    return this.prisma.group.update({ where: { id }, data: dto });
  }
  deleteGroup(id: string) {
    return this.prisma.group.delete({ where: { id } });
  }

  /** Replace a group's roster wholesale, then re-point that group's matches. */
  async setGroupTeams(groupId: string, dto: SetGroupTeamsDto) {
    await this.prisma.groupTeam.deleteMany({ where: { groupId } });
    if (dto.teamIds.length) {
      await this.prisma.groupTeam.createMany({
        data: dto.teamIds.map((teamId) => ({ groupId, teamId })),
        skipDuplicates: true,
      });
    }
    return this.prisma.groupTeam.findMany({
      where: { groupId },
      include: { team: true },
    });
  }

  // ── Round ──
  createRound(dto: CreateRoundDto) {
    return this.prisma.round.create({ data: dto });
  }
  updateRound(id: string, dto: UpdateRoundDto) {
    return this.prisma.round.update({ where: { id }, data: dto });
  }
  deleteRound(id: string) {
    return this.prisma.round.delete({ where: { id } });
  }

  // ── Tie ──
  createTie(dto: CreateTieDto) {
    const { homeSource, awaySource, ...rest } = dto;
    return this.prisma.tie.create({
      data: {
        ...rest,
        homeSource: jsonInput(homeSource),
        awaySource: jsonInput(awaySource),
      },
    });
  }
  updateTie(id: string, dto: UpdateTieDto) {
    const { homeSource, awaySource, ...rest } = dto;
    return this.prisma.tie.update({
      where: { id },
      data: {
        ...rest,
        homeSource: jsonInput(homeSource),
        awaySource: jsonInput(awaySource),
      },
    });
  }
  deleteTie(id: string) {
    return this.prisma.tie.delete({ where: { id } });
  }

  /** Manually trigger feeder resolution / aggregate recompute for a season. */
  async resolve(seasonId: string): Promise<{ ok: true }> {
    await this.resolver.resolveSeason(seasonId);
    return { ok: true };
  }
}
