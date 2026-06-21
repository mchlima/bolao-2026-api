import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NewsItem, Post as PostModel, UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Paginated } from '../common/pagination';
import type { SafeUser } from '../users/user.types';
import { NewsItemsService } from './news-items.service';
import { ListItemsQueryDto, PromoteItemDto, ReprocessItemDto, UpdateItemSeoDto, UpdateItemTaxonomyDto } from './dto/news-item.dto';

@Controller('admin/content/items')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminNewsItemsController {
  constructor(private readonly items: NewsItemsService) {}

  @Get()
  list(@Query() q: ListItemsQueryDto): Promise<Paginated<NewsItem>> {
    return this.items.list(q);
  }

  @Get(':id')
  getOne(@Param('id') id: string): Promise<NewsItem> {
    return this.items.getOne(id);
  }

  @Get(':id/export')
  export(@Param('id') id: string): Promise<{ filename: string; content: string }> {
    return this.items.export(id);
  }

  /** Promove pro CMS: cria um Post (rascunho, ou publicado se publish=true). */
  @Post(':id/promote')
  promote(
    @Param('id') id: string,
    @Body() dto: PromoteItemDto,
    @CurrentUser() admin: SafeUser,
  ): Promise<PostModel> {
    return this.items.promote(id, admin.id, dto.publish ?? false);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @CurrentUser() admin: SafeUser): Promise<NewsItem> {
    return this.items.reject(id, admin.id);
  }

  /** Editor polish of the generated SEO/GEO package (slug, meta, tags, FAQ…). */
  @Patch(':id/seo')
  updateSeo(@Param('id') id: string, @Body() dto: UpdateItemSeoDto): Promise<NewsItem> {
    return this.items.updateSeo(id, dto);
  }

  /** Admin seleciona categoria + tags (entidades) na revisão. */
  @Put(':id/taxonomy')
  updateTaxonomy(@Param('id') id: string, @Body() dto: UpdateItemTaxonomyDto): Promise<NewsItem> {
    return this.items.updateTaxonomy(id, dto);
  }

  /** Re-generate with an editor steer (appends a revision). */
  @Post(':id/reprocess')
  reprocess(@Param('id') id: string, @Body() dto: ReprocessItemDto): Promise<NewsItem> {
    return this.items.reprocess(id, dto);
  }

  /** Override the auto-filter / a rejection: generate from existing facts. */
  @Post(':id/rescue')
  rescue(@Param('id') id: string, @Query('force') force?: string): Promise<NewsItem> {
    return this.items.rescue(id, force === 'true');
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.items.remove(id);
  }
}
