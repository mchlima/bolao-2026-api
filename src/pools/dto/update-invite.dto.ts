import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateInviteDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name?: string;

  // Revoke (false) or reactivate (true) the link without deleting its history.
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
