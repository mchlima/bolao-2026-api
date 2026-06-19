import { IsJWT, IsString } from 'class-validator';

export class GoogleAuthDto {
  /** The ID token issued by Google Identity Services on the client. */
  @IsString()
  @IsJWT()
  idToken!: string;
}
