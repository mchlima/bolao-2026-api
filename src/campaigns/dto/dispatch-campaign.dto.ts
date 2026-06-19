import { IsDateString, IsOptional } from 'class-validator';

// Finalize a campaign's dispatch: send now (no sendAt) or schedule (future sendAt).
export class DispatchCampaignDto {
  @IsOptional()
  @IsDateString()
  sendAt?: string;
}
