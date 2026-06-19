import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// Delivery channels enabled today; "email" is reserved for the future.
export const CAMPAIGN_CHANNELS = ['inapp', 'push'] as const;

export class CreateCampaignDto {
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

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(CAMPAIGN_CHANNELS, { each: true })
  channels!: string[];

  @IsBoolean()
  audienceAll!: boolean;

  /** Boolean filter tree; ignored when audienceAll. Validated defensively at use. */
  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;

  /** ISO datetime. Absent = draft (no schedule); present = scheduled/immediate. */
  @IsOptional()
  @IsDateString()
  sendAt?: string;
}
