import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NewsFeed, UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Paginated } from '../common/pagination';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { FeedPreview, FetchResult } from './content-ingest.service';
import { NewsFeedsService } from './news-feeds.service';
import { CreateNewsFeedDto, PreviewFeedDto, UpdateNewsFeedDto } from './dto/news-feed.dto';

@Controller('admin/content/feeds')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminNewsFeedsController {
  constructor(private readonly feeds: NewsFeedsService) {}

  @Get()
  list(@Query() q: PaginationQueryDto): Promise<Paginated<NewsFeed>> {
    return this.feeds.list(q.page, q.pageSize, q.search);
  }

  /** Validate/preview an RSS URL before saving ("testar"). */
  @Post('preview')
  @HttpCode(200)
  preview(@Body() dto: PreviewFeedDto): Promise<FeedPreview> {
    return this.feeds.preview(dto.url);
  }

  @Post()
  create(@Body() dto: CreateNewsFeedDto): Promise<NewsFeed> {
    return this.feeds.create(dto);
  }

  @Get(':id')
  getOne(@Param('id') id: string): Promise<NewsFeed> {
    return this.feeds.getOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNewsFeedDto): Promise<NewsFeed> {
    return this.feeds.update(id, dto);
  }

  /** "Buscar agora": immediate fetch, returns # of new items. */
  @Post(':id/fetch')
  @HttpCode(200)
  fetch(@Param('id') id: string): Promise<FetchResult> {
    return this.feeds.fetchNow(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.feeds.remove(id);
  }
}
