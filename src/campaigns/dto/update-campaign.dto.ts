import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CAMPAIGN_CHANNELS } from './create-campaign.dto';

// Edit a DRAFT/SCHEDULED campaign. Scheduling is handled separately (dispatch /
// cancel), so sendAt isn't editable here — only the message, channels, audience.
export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(CAMPAIGN_CHANNELS, { each: true })
  channels?: string[];

  @IsOptional()
  @IsBoolean()
  audienceAll?: boolean;

  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown> | null;
}
