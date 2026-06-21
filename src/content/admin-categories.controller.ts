import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { Category, UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CategoriesService, CategoryNode } from './categories.service';
import { CreateTaxonomyDto, UpdateTaxonomyDto } from './dto/news-taxonomy.dto';

@Controller('admin/content/categories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** Árvore completa (lista achatada em DFS, com profundidade/caminho/contagem). */
  @Get()
  tree(): Promise<CategoryNode[]> {
    return this.categories.tree();
  }

  @Post()
  create(@Body() dto: CreateTaxonomyDto): Promise<Category> {
    return this.categories.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaxonomyDto): Promise<Category> {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.categories.remove(id);
  }
}
