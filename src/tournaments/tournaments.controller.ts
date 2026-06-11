import { Controller, Get, Param, Query } from '@nestjs/common';
import { Tournament } from '@prisma/client';
import { Paginated } from '../common/pagination';
import { QueryTournamentsDto } from './dto/query-tournaments.dto';
import { TournamentsService } from './tournaments.service';

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  @Get()
  findAll(
    @Query() query: QueryTournamentsDto,
  ): Promise<Paginated<Tournament>> {
    return this.tournaments.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Tournament> {
    return this.tournaments.findOne(id);
  }
}
