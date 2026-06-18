import { Module } from '@nestjs/common';
import { AdminPredictionsController } from './admin-predictions.controller';
import { PredictionsController } from './predictions.controller';
import { PredictionsService } from './predictions.service';

@Module({
  controllers: [PredictionsController, AdminPredictionsController],
  providers: [PredictionsService],
  exports: [PredictionsService],
})
export class PredictionsModule {}
