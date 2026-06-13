import { Module } from '@nestjs/common';
import { AdminSeasonsController } from './admin-seasons.controller';
import { SeasonsController } from './seasons.controller';
import { SeasonsService } from './seasons.service';

@Module({
  controllers: [SeasonsController, AdminSeasonsController],
  providers: [SeasonsService],
  exports: [SeasonsService],
})
export class SeasonsModule {}
