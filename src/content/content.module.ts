import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { ArticleFetchService } from './article-fetch.service';
import { ContentIngestService } from './content-ingest.service';
import { ContentProcessService } from './content-process.service';
import { RssConnector } from './connectors/rss.connector';
import { NewsApiConnector } from './connectors/news-api.connector';
import { PageConnector } from './connectors/page.connector';
import { TopicConnector } from './connectors/topic.connector';
import { NewsFeedsService } from './news-feeds.service';
import { NewsTonesService } from './news-tones.service';
import { NewsItemsService } from './news-items.service';
import { AdminNewsFeedsController } from './admin-news-feeds.controller';
import { AdminNewsTonesController } from './admin-news-tones.controller';
import { AdminNewsItemsController } from './admin-news-items.controller';
import { AdminContentSettingsController } from './admin-content-settings.controller';
import { AdminContentDashboardController } from './admin-content-dashboard.controller';
import { ContentSettingsService } from './content-settings.service';

// Content pipeline: RSS ingest → LLM extract/classify → rewrite in a tom → review.
// Engine (ingest/process crons) + admin CRUD for feeds, tons and items.
@Module({
  controllers: [
    AdminNewsFeedsController,
    AdminNewsTonesController,
    AdminNewsItemsController,
    AdminContentSettingsController,
    AdminContentDashboardController,
  ],
  providers: [
    ContentSettingsService,
    LlmService,
    ArticleFetchService,
    RssConnector,
    NewsApiConnector,
    PageConnector,
    TopicConnector,
    ContentIngestService,
    ContentProcessService,
    NewsFeedsService,
    NewsTonesService,
    NewsItemsService,
  ],
  exports: [LlmService, ContentIngestService, ContentProcessService],
})
export class ContentModule {}
