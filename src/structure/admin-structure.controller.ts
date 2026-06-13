import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminStructureService } from './admin-structure.service';
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

@Controller('admin/structure')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminStructureController {
  constructor(private readonly svc: AdminStructureService) {}

  // Stage
  @Post('stages') createStage(@Body() dto: CreateStageDto) {
    return this.svc.createStage(dto);
  }
  @Patch('stages/:id') updateStage(
    @Param('id') id: string,
    @Body() dto: UpdateStageDto,
  ) {
    return this.svc.updateStage(id, dto);
  }
  @Delete('stages/:id') @HttpCode(204) deleteStage(@Param('id') id: string) {
    return this.svc.deleteStage(id).then(() => undefined);
  }

  // Group
  @Post('groups') createGroup(@Body() dto: CreateGroupDto) {
    return this.svc.createGroup(dto);
  }
  @Patch('groups/:id') updateGroup(
    @Param('id') id: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.svc.updateGroup(id, dto);
  }
  @Delete('groups/:id') @HttpCode(204) deleteGroup(@Param('id') id: string) {
    return this.svc.deleteGroup(id).then(() => undefined);
  }
  @Put('groups/:id/teams') setGroupTeams(
    @Param('id') id: string,
    @Body() dto: SetGroupTeamsDto,
  ) {
    return this.svc.setGroupTeams(id, dto);
  }

  // Round
  @Post('rounds') createRound(@Body() dto: CreateRoundDto) {
    return this.svc.createRound(dto);
  }
  @Patch('rounds/:id') updateRound(
    @Param('id') id: string,
    @Body() dto: UpdateRoundDto,
  ) {
    return this.svc.updateRound(id, dto);
  }
  @Delete('rounds/:id') @HttpCode(204) deleteRound(@Param('id') id: string) {
    return this.svc.deleteRound(id).then(() => undefined);
  }

  // Tie
  @Post('ties') createTie(@Body() dto: CreateTieDto) {
    return this.svc.createTie(dto);
  }
  @Patch('ties/:id') updateTie(
    @Param('id') id: string,
    @Body() dto: UpdateTieDto,
  ) {
    return this.svc.updateTie(id, dto);
  }
  @Delete('ties/:id') @HttpCode(204) deleteTie(@Param('id') id: string) {
    return this.svc.deleteTie(id).then(() => undefined);
  }

  // Trigger feeder resolution / aggregate recompute for a season.
  @Post('seasons/:seasonId/resolve') resolve(
    @Param('seasonId') seasonId: string,
  ) {
    return this.svc.resolve(seasonId);
  }
}
