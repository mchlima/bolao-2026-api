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
import { NewsTone, UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Paginated } from '../common/pagination';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { NewsTonesService } from './news-tones.service';
import { CreateNewsToneDto, UpdateNewsToneDto } from './dto/news-tone.dto';

@Controller('admin/content/tones')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminNewsTonesController {
  constructor(private readonly tones: NewsTonesService) {}

  @Get()
  list(@Query() q: PaginationQueryDto): Promise<Paginated<NewsTone>> {
    return this.tones.list(q.page, q.pageSize);
  }

  @Post()
  create(@Body() dto: CreateNewsToneDto): Promise<NewsTone> {
    return this.tones.create(dto);
  }

  @Get(':id')
  getOne(@Param('id') id: string): Promise<NewsTone> {
    return this.tones.getOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNewsToneDto): Promise<NewsTone> {
    return this.tones.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.tones.remove(id);
  }
}
