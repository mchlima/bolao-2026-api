import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { TeamsModule } from './teams/teams.module';
import { StadiumsModule } from './stadiums/stadiums.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { MatchesModule } from './matches/matches.module';
import { ScoringModule } from './scoring/scoring.module';
import { PredictionsModule } from './predictions/predictions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ScoringModule,
    HealthModule,
    UsersModule,
    AuthModule,
    TeamsModule,
    StadiumsModule,
    TournamentsModule,
    MatchesModule,
    PredictionsModule,
    // Remaining feature modules added per build step (rankings + engagement,
    // admin dashboard/live control) — see docs §6.
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
