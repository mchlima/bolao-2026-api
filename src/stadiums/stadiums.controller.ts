import { Controller, Get, Param, Query } from '@nestjs/common';
import { Stadium } from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Paginated } from '../common/pagination';
import { StadiumsService } from './stadiums.service';

@Controller('stadiums')
export class StadiumsController {
  constructor(private readonly stadiums: StadiumsService) {}

  @Get()
  findAll(@Query() query: PaginationQueryDto): Promise<Paginated<Stadium>> {
    return this.stadiums.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Stadium> {
    return this.stadiums.findOne(id);
  }
}
