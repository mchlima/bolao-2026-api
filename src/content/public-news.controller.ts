import { Controller, Get, Param, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { Paginated } from '../common/pagination';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { NewsArticle, NewsCard, PublicNewsService, TermPage } from './public-news.service';

class ListNewsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() category?: string; // slug da categoria
  @IsOptional() @IsString() tag?: string; // slug da tag
}

/** Public (no auth) feed of approved articles — the organic-traffic surface. */
@Controller('content/news')
export class PublicNewsController {
  constructor(private readonly news: PublicNewsService) {}

  @Get()
  list(@Query() q: ListNewsQueryDto): Promise<Paginated<NewsCard>> {
    return this.news.list(q.page, q.pageSize, {
      categorySlug: q.category?.trim() || undefined,
      tagSlug: q.tag?.trim() || undefined,
    });
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string): Promise<NewsArticle> {
    return this.news.getBySlug(slug);
  }
}

/** Públicos: categorias e tags (cabeçalho das páginas + sitemap). */
@Controller('content')
export class PublicTaxonomyController {
  constructor(private readonly news: PublicNewsService) {}

  @Get('categories')
  categories(): Promise<TermPage[]> {
    return this.news.listCategories();
  }

  @Get('categories/:slug')
  category(@Param('slug') slug: string): Promise<TermPage> {
    return this.news.getCategory(slug);
  }

  @Get('tags')
  tags(): Promise<TermPage[]> {
    return this.news.listTags();
  }

  @Get('tags/:slug')
  tag(@Param('slug') slug: string): Promise<TermPage> {
    return this.news.getTag(slug);
  }
}
