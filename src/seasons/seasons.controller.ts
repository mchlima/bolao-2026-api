import { Controller, Get, Param, Query } from '@nestjs/common';
import { Season } from '@prisma/client';
import { Paginated } from '../common/pagination';
import { QuerySeasonsDto } from './dto/query-seasons.dto';
import { SeasonsService } from './seasons.service';

@Controller('seasons')
export class SeasonsController {
  constructor(private readonly seasons: SeasonsService) {}

  @Get()
  findAll(@Query() query: QuerySeasonsDto): Promise<Paginated<Season>> {
    return this.seasons.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Season> {
    return this.seasons.findOne(id);
  }
}
