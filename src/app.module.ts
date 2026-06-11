import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    // Feature modules added per build step (auth, users, teams, stadiums,
    // tournaments, matches, predictions, rankings, admin) — see docs §6.
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
