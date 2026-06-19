import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationCampaign, UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Paginated } from '../common/pagination';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { SafeUser } from '../users/user.types';
import { CampaignsService } from './campaigns.service';
import { AudiencePreviewDto } from './dto/audience-preview.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { DispatchCampaignDto } from './dto/dispatch-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { AudienceSpec } from './audience.types';

@Controller('admin/campaigns')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminCampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list(@Query() q: PaginationQueryDto): Promise<Paginated<NotificationCampaign>> {
    return this.campaigns.list(q.page, q.pageSize);
  }

  /** Live "quantos se enquadram" for the wizard. */
  @Post('audience/preview')
  @HttpCode(200)
  async preview(@Body() dto: AudiencePreviewDto): Promise<{ count: number }> {
    const spec: AudienceSpec = { all: dto.all, filter: (dto.filter as AudienceSpec['filter']) ?? null };
    return { count: await this.campaigns.previewCount(spec) };
  }

  @Post()
  create(
    @Body() dto: CreateCampaignDto,
    @CurrentUser() admin: SafeUser,
  ): Promise<NotificationCampaign> {
    return this.campaigns.create(dto, admin.id);
  }

  @Get(':id')
  getOne(@Param('id') id: string): Promise<NotificationCampaign> {
    return this.campaigns.getOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCampaignDto): Promise<NotificationCampaign> {
    return this.campaigns.update(id, dto);
  }

  /** "Finalizar o disparo": enviar agora ou agendar. */
  @Post(':id/dispatch')
  dispatch(@Param('id') id: string, @Body() dto: DispatchCampaignDto): Promise<NotificationCampaign> {
    return this.campaigns.dispatchCampaign(id, dto);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string): Promise<NotificationCampaign> {
    return this.campaigns.cancel(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.campaigns.remove(id);
  }
}
