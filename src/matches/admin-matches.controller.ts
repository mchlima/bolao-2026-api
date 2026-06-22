import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { MatchNote, UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { SafeUser } from '../users/user.types';
import { CreateMatchDto } from './dto/create-match.dto';
import { CreateMatchNoteDto } from './dto/match-note.dto';
import { UpdateMatchDto } from './dto/update-match.dto';
import { MatchesService, MatchWithRelations } from './matches.service';

@Controller('admin/matches')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminMatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Post()
  create(@Body() dto: CreateMatchDto): Promise<MatchWithRelations> {
    return this.matches.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMatchDto,
    @CurrentUser() admin: SafeUser,
  ): Promise<MatchWithRelations> {
    return this.matches.update(id, dto, admin.id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.matches.remove(id);
  }

  // ───────────────────────────── narração ao vivo (comentários do admin → fatos)

  @Get(':id/notes')
  listNotes(@Param('id') id: string): Promise<MatchNote[]> {
    return this.matches.listNotes(id);
  }

  @Post(':id/notes')
  addNote(
    @Param('id') id: string,
    @Body() dto: CreateMatchNoteDto,
    @CurrentUser() admin: SafeUser,
  ): Promise<MatchNote> {
    return this.matches.addNote(id, dto.text, dto.minute ?? null, admin.id);
  }

  @Patch(':id/notes/:noteId')
  updateNote(
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body() dto: CreateMatchNoteDto,
  ): Promise<MatchNote> {
    return this.matches.updateNote(id, noteId, dto.text, dto.minute ?? null);
  }

  @Delete(':id/notes/:noteId')
  @HttpCode(204)
  removeNote(@Param('id') id: string, @Param('noteId') noteId: string): Promise<void> {
    return this.matches.removeNote(id, noteId);
  }
}
