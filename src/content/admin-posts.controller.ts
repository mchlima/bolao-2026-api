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
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Paginated } from '../common/pagination';
import type { SafeUser } from '../users/user.types';
import { PostListRow, PostsService, PostView } from './posts.service';
import { CreatePostDto, ListPostsQueryDto, ToggleFeaturedDto, UpdatePostDto } from './dto/post.dto';

@Controller('admin/posts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  list(@Query() q: ListPostsQueryDto): Promise<Paginated<PostListRow>> {
    return this.posts.list(q);
  }

  @Get(':id')
  getOne(@Param('id') id: string): Promise<PostView> {
    return this.posts.getOne(id);
  }

  @Post()
  create(@Body() dto: CreatePostDto, @CurrentUser() admin: SafeUser): Promise<PostView> {
    return this.posts.createManual(dto, admin.id);
  }

  @Patch(':id')
  save(@Param('id') id: string, @Body() dto: UpdatePostDto): Promise<PostView> {
    return this.posts.save(id, dto);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @CurrentUser() admin: SafeUser): Promise<PostView> {
    return this.posts.publish(id, admin.id);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string): Promise<PostView> {
    return this.posts.archive(id);
  }

  /** Liga/desliga o destaque editorial (manchete da home + topo de /noticias). */
  @Patch(':id/featured')
  setFeatured(@Param('id') id: string, @Body() dto: ToggleFeaturedDto): Promise<PostView> {
    return this.posts.setFeatured(id, dto.featured);
  }

  /** (Re)gera a capa do post a partir do jogo vinculado (escudos + placar). */
  @Post(':id/cover')
  setCover(@Param('id') id: string): Promise<PostView> {
    return this.posts.setCover(id);
  }

  @Post(':id/discard-draft')
  discardDraft(@Param('id') id: string): Promise<PostView> {
    return this.posts.discardDraft(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.posts.remove(id);
  }
}
