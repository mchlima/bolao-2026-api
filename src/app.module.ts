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
import { RankingsModule } from './rankings/rankings.module';
import { AuditModule } from './audit/audit.module';
import { AdminModule } from './admin/admin.module';
import { StorageModule } from './storage/storage.module';
import { ScheduleModule } from '@nestjs/schedule';
import { LiveIngestModule } from './live-ingest/live-ingest.module';
import { MatchWindowModule } from './match-window/match-window.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    EventsModule,
    ScoringModule,
    AuditModule,
    StorageModule,
    HealthModule,
    UsersModule,
    AuthModule,
    TeamsModule,
    StadiumsModule,
    TournamentsModule,
    MatchesModule,
    PredictionsModule,
    RankingsModule,
    AdminModule,
    LiveIngestModule,
    MatchWindowModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
