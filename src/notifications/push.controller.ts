import { Body, Controller, Delete, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { SafeUser } from '../users/user.types';
import { RemoveSubscriptionDto, SaveSubscriptionDto } from './dto/save-subscription.dto';
import { PushService } from './push.service';

@Controller('me/push')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post()
  @HttpCode(204)
  subscribe(
    @CurrentUser() user: SafeUser,
    @Body() dto: SaveSubscriptionDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<void> {
    return this.push.saveSubscription(user.id, dto, userAgent);
  }

  @Delete()
  @HttpCode(204)
  unsubscribe(@CurrentUser() user: SafeUser, @Body() dto: RemoveSubscriptionDto): Promise<void> {
    return this.push.removeSubscription(user.id, dto.endpoint);
  }
}
