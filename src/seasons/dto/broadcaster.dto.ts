import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

// One curated rights holder for a Season's "onde assistir" (e.g. CazéTV on
// YouTube). Display-only; persisted as JSON on Season.broadcasters.
export class BroadcasterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(300)
  url?: string;
}
