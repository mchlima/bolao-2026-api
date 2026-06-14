import { Controller, Get, Query } from '@nestjs/common';
import { AgendaService } from './agenda.service';
import { AgendaQueryDto } from './dto/agenda-query.dto';

// Public, read-only. Cross-tournament match calendar grouped by day; filterable
// by sport / competition / season and by window (scope or from/to).
@Controller('agenda')
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  @Get()
  list(@Query() query: AgendaQueryDto) {
    return this.agenda.agenda(query);
  }
}
