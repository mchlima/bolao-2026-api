import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

// PrismaModule, EventsModule e AuditModule são @Global — ChatService injeta os três
// (PrismaService, EventsService, AuditService) sem precisar importá-los aqui.
@Module({
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
