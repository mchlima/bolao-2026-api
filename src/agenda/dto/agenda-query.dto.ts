import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export type AgendaScope = 'live' | 'today' | 'upcoming' | 'past' | 'all';
const SCOPES: AgendaScope[] = ['live', 'today', 'upcoming', 'past', 'all'];

export class AgendaQueryDto {
  // Window selector. Default 'upcoming'. A from/to range overrides it.
  @IsOptional()
  @IsIn(SCOPES)
  scope?: AgendaScope;

  // Tournament scoping (most specific wins): season → competition → sport.
  @IsOptional()
  @IsString()
  seasonId?: string;

  @IsOptional()
  @IsString()
  competitionId?: string;

  @IsOptional()
  @IsString()
  sportId?: string;

  // Filtra os jogos de um time específico (mandante OU visitante) — alimenta a
  // página pública da seleção/time.
  @IsOptional()
  @IsString()
  teamId?: string;

  // Optional explicit date window (YYYY-MM-DD, interpreted in America/São_Paulo).
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from deve ser YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to deve ser YYYY-MM-DD' })
  to?: string;

  // Cap the number of matches returned (1–500). Lets light consumers (e.g. the
  // home "próximos jogos" strip, which shows ~6) ask for just the next few
  // instead of the whole upcoming list. Parsed in the service.
  @IsOptional()
  @Matches(/^\d{1,3}$/, { message: 'limit deve ser um número (1-500)' })
  limit?: string;
}
