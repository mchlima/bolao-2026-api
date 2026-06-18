import { IsInt, Max, Min } from 'class-validator';

/** Admin manual prediction: score only — userId and matchId come from the path. */
export class AdminUpsertPredictionDto {
  @IsInt()
  @Min(0)
  @Max(99)
  homeScore!: number;

  @IsInt()
  @Min(0)
  @Max(99)
  awayScore!: number;
}
