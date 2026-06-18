import { IsString } from 'class-validator';

/** Admin view of one user's predictions across a season's matches. */
export class AdminListPredictionsDto {
  @IsString()
  userId!: string;

  @IsString()
  seasonId!: string;
}
