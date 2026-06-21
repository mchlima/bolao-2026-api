import { Controller, Get, Param, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { Paginated } from '../common/pagination';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { NewsArticle, NewsCard, PublicNewsService } from './public-news.service';

class ListNewsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  category?: string;
}

/** Public (no auth) feed of approved articles — the organic-traffic surface. */
@Controller('content/news')
export class PublicNewsController {
  constructor(private readonly news: PublicNewsService) {}

  @Get()
  list(@Query() q: ListNewsQueryDto): Promise<Paginated<NewsCard>> {
    return this.news.list(q.page, q.pageSize, q.category?.trim() || undefined);
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string): Promise<NewsArticle> {
    return this.news.getBySlug(slug);
  }
}
