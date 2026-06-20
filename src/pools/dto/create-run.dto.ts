import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Open a new temporada (run) in an existing pool. */
export class CreateRunDto {
  // The season this temporada disputes (same pool can hop tournaments).
  @IsString()
  seasonId!: string;

  // Optional custom name; defaults to "Temporada N".
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  // Start immediately instead of leaving it as DRAFT.
  @IsOptional()
  @IsBoolean()
  start?: boolean;
}
