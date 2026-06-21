import { IsString, MaxLength, MinLength } from 'class-validator';

/** Um comentário do admin na narração ao vivo (só texto). */
export class CreateMatchNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;
}
