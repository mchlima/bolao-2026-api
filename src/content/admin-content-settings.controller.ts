import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ContentConfig, ContentSettingsService } from './content-settings.service';

const MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8'];

class UpdateConfigDto {
  @IsOptional() @IsBoolean() paused?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) dailyBudgetUsd?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100000) maxPerDay?: number;
  @IsOptional() @IsIn(MODELS) extractModel?: string;
  @IsOptional() @IsIn(MODELS) generateModel?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) relevanceMin?: number;
}

@Controller('admin/content/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminContentSettingsController {
  constructor(private readonly settings: ContentSettingsService) {}

  @Get()
  get(): Promise<ContentConfig> {
    return this.settings.getConfig();
  }

  @Patch()
  update(@Body() dto: UpdateConfigDto): Promise<ContentConfig> {
    return this.settings.setConfig(dto);
  }
}
