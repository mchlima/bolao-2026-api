import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { Tag, UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Paginated } from '../common/pagination';
import { TagsService } from './tags.service';
import { CreateTaxonomyDto, ListTaxonomyQueryDto, UpdateTaxonomyDto } from './dto/news-taxonomy.dto';

@Controller('admin/content/tags')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminTagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  list(@Query() q: ListTaxonomyQueryDto): Promise<Paginated<Tag>> {
    return this.tags.list(q.page, q.pageSize, q.q);
  }

  @Post()
  create(@Body() dto: CreateTaxonomyDto): Promise<Tag> {
    return this.tags.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaxonomyDto): Promise<Tag> {
    return this.tags.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.tags.remove(id);
  }
}
