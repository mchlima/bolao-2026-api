import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Uma mensagem nova no chat da partida. O texto é re-trimado no service (e
 * rejeitado se ficar vazio). */
export class CreateChatMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  /** Id efêmero gerado pelo cliente p/ casar o eco do SSE com a mensagem
   * renderizada otimisticamente (evita duplicar a própria mensagem). Opcional. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  nonce?: string;
}
