import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateInviteDto {
  // Named link, WhatsApp-style: "Turma do trabalho", "WhatsApp"...
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;
}
