import { Module } from '@nestjs/common';
import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';

// PrismaModule is @Global. Public match calendar (no auth).
@Module({
  controllers: [AgendaController],
  providers: [AgendaService],
})
export class AgendaModule {}
