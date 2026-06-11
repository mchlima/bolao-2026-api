import { Module } from '@nestjs/common';
import { AdminStadiumsController } from './admin-stadiums.controller';
import { StadiumsController } from './stadiums.controller';
import { StadiumsService } from './stadiums.service';

@Module({
  controllers: [StadiumsController, AdminStadiumsController],
  providers: [StadiumsService],
  exports: [StadiumsService],
})
export class StadiumsModule {}
