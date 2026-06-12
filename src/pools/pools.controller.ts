import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type {
  MatchRankingResponse,
  RankingResponse,
} from '../rankings/rankings.service';
import type { SafeUser } from '../users/user.types';
import { CreateInviteDto } from './dto/create-invite.dto';
import { CreatePoolDto } from './dto/create-pool.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { UpdateInviteDto } from './dto/update-invite.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { UpdatePoolDto } from './dto/update-pool.dto';
import type {
  JoinPreview,
  PoolDetail,
  PoolInviteView,
  PoolSummary,
} from './pool.types';
import { PoolsService } from './pools.service';

// Every pool operation requires a logged-in user. Read access to a pool is
// gated to its members; management to owner/admin — enforced in the service.
@Controller('pools')
@UseGuards(JwtAuthGuard)
export class PoolsController {
  constructor(private readonly pools: PoolsService) {}

  @Post()
  create(
    @CurrentUser() user: SafeUser,
    @Body() dto: CreatePoolDto,
  ): Promise<PoolDetail> {
    return this.pools.create(user.id, dto);
  }

  /** The current user's pools. */
  @Get('me')
  mine(@CurrentUser() user: SafeUser): Promise<PoolSummary[]> {
    return this.pools.listMine(user.id);
  }

  // ── Joining (static 'join' segment declared before ':id') ──

  @Get('join/:code')
  joinPreview(
    @CurrentUser() user: SafeUser,
    @Param('code') code: string,
  ): Promise<JoinPreview> {
    return this.pools.joinPreview(code, user.id);
  }

  @Post('join/:code')
  join(
    @CurrentUser() user: SafeUser,
    @Param('code') code: string,
  ): Promise<PoolDetail> {
    return this.pools.join(code, user.id);
  }

  // ── Single pool ──

  @Get(':id')
  detail(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<PoolDetail> {
    return this.pools.detail(id, user.id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: UpdatePoolDto,
  ): Promise<PoolDetail> {
    return this.pools.update(id, user.id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.pools.remove(id, user.id);
  }

  @Post(':id/transfer')
  @HttpCode(200)
  transfer(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: TransferOwnershipDto,
  ): Promise<PoolDetail> {
    return this.pools.transferOwnership(id, user.id, dto.userId);
  }

  @Post(':id/leave')
  @HttpCode(200)
  leave(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.pools.leave(id, user.id);
  }

  // ── Invite links ──

  @Post(':id/invites')
  createInvite(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: CreateInviteDto,
  ): Promise<PoolInviteView> {
    return this.pools.createInvite(id, user.id, dto);
  }

  @Get(':id/invites')
  listInvites(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<PoolInviteView[]> {
    return this.pools.listInvites(id, user.id);
  }

  @Patch(':id/invites/:inviteId')
  updateInvite(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('inviteId') inviteId: string,
    @Body() dto: UpdateInviteDto,
  ): Promise<PoolInviteView> {
    return this.pools.updateInvite(id, user.id, inviteId, dto);
  }

  @Delete(':id/invites/:inviteId')
  deleteInvite(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('inviteId') inviteId: string,
  ): Promise<void> {
    return this.pools.deleteInvite(id, user.id, inviteId);
  }

  // ── Members ──

  @Patch(':id/members/:userId')
  updateMemberRole(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<PoolDetail> {
    return this.pools.updateMemberRole(id, user.id, targetUserId, dto);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ): Promise<void> {
    return this.pools.removeMember(id, user.id, targetUserId);
  }

  // ── Scoped rankings (members only) ──

  @Get(':id/ranking')
  ranking(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<RankingResponse> {
    return this.pools.tournamentRanking(id, user.id);
  }

  @Get(':id/matches/:matchId/ranking')
  matchRanking(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('matchId') matchId: string,
  ): Promise<MatchRankingResponse> {
    return this.pools.matchRanking(id, matchId, user.id);
  }
}
