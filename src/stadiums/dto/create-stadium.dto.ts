import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateStadiumDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  country!: string;
}
