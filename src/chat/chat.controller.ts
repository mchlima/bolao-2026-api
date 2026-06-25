import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { SafeUser } from '../users/user.types';
import { ChatService } from './chat.service';
import { ChatListResult, ChatMessageView } from './chat.types';
import { CreateChatMessageDto } from './dto/create-chat-message.dto';

// Chat da partida ESCOPADO ao bolão. Toda rota exige login; a autorização fina
// (membro do bolão + partida ∈ temporada do bolão) fica no ChatService.
@Controller()
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('pools/:poolId/matches/:matchId/chat')
  list(
    @CurrentUser() user: SafeUser,
    @Param('poolId') poolId: string,
    @Param('matchId') matchId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ): Promise<ChatListResult> {
    return this.chat.list(user, poolId, matchId, {
      before,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('pools/:poolId/matches/:matchId/chat')
  post(
    @CurrentUser() user: SafeUser,
    @Param('poolId') poolId: string,
    @Param('matchId') matchId: string,
    @Body() dto: CreateChatMessageDto,
  ): Promise<ChatMessageView> {
    return this.chat.post(user, poolId, matchId, {
      text: dto.text,
      nonce: dto.nonce,
    });
  }

  @Delete('chat/:messageId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: SafeUser,
    @Param('messageId') messageId: string,
  ): Promise<void> {
    return this.chat.remove(user, messageId);
  }
}
