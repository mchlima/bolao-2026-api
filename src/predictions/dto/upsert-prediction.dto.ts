import { IsInt, IsString, Max, Min } from 'class-validator';

export class UpsertPredictionDto {
  @IsString()
  matchId!: string;

  @IsInt()
  @Min(0)
  @Max(99)
  homeScore!: number;

  @IsInt()
  @Min(0)
  @Max(99)
  awayScore!: number;
}
