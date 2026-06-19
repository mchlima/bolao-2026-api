import { IsBoolean, IsObject, IsOptional } from 'class-validator';

// Live "quantos se enquadram" count for the wizard.
export class AudiencePreviewDto {
  @IsBoolean()
  all!: boolean;

  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown> | null;
}
