import { Module } from '@nestjs/common';
import { StructureModule } from '../structure/structure.module';
import { LlmService } from './llm.service';
import { ArticleFetchService } from './article-fetch.service';
import { ContentIngestService } from './content-ingest.service';
import { ContentProcessService } from './content-process.service';
import { MatchFactPackService } from './match-fact-pack.service';
import { RssConnector } from './connectors/rss.connector';
import { NewsApiConnector } from './connectors/news-api.connector';
import { PageConnector } from './connectors/page.connector';
import { TopicConnector } from './connectors/topic.connector';
import { MatchReportConnector } from './connectors/match-report.connector';
import { NewsFeedsService } from './news-feeds.service';
import { NewsTonesService } from './news-tones.service';
import { NewsItemsService } from './news-items.service';
import { AdminNewsFeedsController } from './admin-news-feeds.controller';
import { AdminNewsTonesController } from './admin-news-tones.controller';
import { AdminNewsItemsController } from './admin-news-items.controller';
import { AdminPostsController } from './admin-posts.controller';
import { PostsService } from './posts.service';
import { AdminMatchReportController } from './admin-match-report.controller';
import { MatchReportService } from './match-report.service';
import { CoverImageService } from './cover-image.service';
import { IndexNowService } from './indexnow.service';
import { AdminContentSettingsController } from './admin-content-settings.controller';
import { AdminContentDashboardController } from './admin-content-dashboard.controller';
import { PublicNewsController, PublicTaxonomyController } from './public-news.controller';
import { PublicNewsService } from './public-news.service';
import { AdminTagsController } from './admin-tags.controller';
import { AdminCategoriesController } from './admin-categories.controller';
import { TagsService } from './tags.service';
import { CategoriesService } from './categories.service';
import { ContentSettingsService } from './content-settings.service';

// Content pipeline: RSS ingest → LLM extract/classify → rewrite in a tom → review.
// Engine (ingest/process crons) + admin CRUD for feeds, tons and items.
@Module({
  imports: [StructureModule],
  controllers: [
    AdminNewsFeedsController,
    AdminNewsTonesController,
    AdminNewsItemsController,
    AdminPostsController,
    AdminMatchReportController,
    AdminContentSettingsController,
    AdminContentDashboardController,
    AdminTagsController,
    AdminCategoriesController,
    PublicNewsController,
    PublicTaxonomyController,
  ],
  providers: [
    ContentSettingsService,
    PublicNewsService,
    TagsService,
    CategoriesService,
    LlmService,
    ArticleFetchService,
    RssConnector,
    NewsApiConnector,
    PageConnector,
    TopicConnector,
    MatchReportConnector,
    MatchFactPackService,
    ContentIngestService,
    ContentProcessService,
    NewsFeedsService,
    NewsTonesService,
    NewsItemsService,
    PostsService,
    MatchReportService,
    CoverImageService,
    IndexNowService,
  ],
  exports: [LlmService, ContentIngestService, ContentProcessService],
})
export class ContentModule {}
