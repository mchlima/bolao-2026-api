import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

// Admin sends a custom notification to a user — now or scheduled. Omitting
// sendAt (or a past value) means "agora": delivered on the next minute tick.
export class SendNotificationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  /** ISO datetime; absent/past = send now. */
  @IsOptional()
  @IsDateString()
  sendAt?: string;
}
