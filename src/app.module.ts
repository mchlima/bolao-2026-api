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
import { CompetitionsModule } from './competitions/competitions.module';
import { SeasonsModule } from './seasons/seasons.module';
import { StructureModule } from './structure/structure.module';
import { MatchesModule } from './matches/matches.module';
import { ScoringModule } from './scoring/scoring.module';
import { PredictionsModule } from './predictions/predictions.module';
import { RankingsModule } from './rankings/rankings.module';
import { PoolsModule } from './pools/pools.module';
import { AuditModule } from './audit/audit.module';
import { AdminModule } from './admin/admin.module';
import { StorageModule } from './storage/storage.module';
import { ScheduleModule } from '@nestjs/schedule';
import { LiveIngestModule } from './live-ingest/live-ingest.module';
import { MatchWindowModule } from './match-window/match-window.module';
import { SeasonRefreshModule } from './season-refresh/season-refresh.module';
import { MatchSummaryModule } from './match-summary/match-summary.module';
import { BackupModule } from './backup/backup.module';
import { AgendaModule } from './agenda/agenda.module';
import { EventsModule } from './events/events.module';
import { AlertsModule } from './alerts/alerts.module';
import { MonitorModule } from './monitor/monitor.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AlertsModule,
    MonitorModule,
    EventsModule,
    ScoringModule,
    AuditModule,
    StorageModule,
    HealthModule,
    UsersModule,
    AuthModule,
    TeamsModule,
    StadiumsModule,
    CompetitionsModule,
    SeasonsModule,
    StructureModule,
    MatchesModule,
    PredictionsModule,
    RankingsModule,
    PoolsModule,
    AdminModule,
    LiveIngestModule,
    MatchWindowModule,
    SeasonRefreshModule,
    MatchSummaryModule,
    BackupModule,
    AgendaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
