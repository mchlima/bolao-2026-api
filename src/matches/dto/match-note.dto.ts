import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Um comentário do admin na narração ao vivo (texto + tempo opcional). */
export class CreateMatchNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  /** Tempo do jogo (ex.: "67'", "45+2"). Vazio/ausente = sem tempo. */
  @IsOptional()
  @IsString()
  @MaxLength(12)
  minute?: string;
}
