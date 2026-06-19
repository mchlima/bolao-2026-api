import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export interface GoogleProfile {
  /** Google's stable account id (the `sub` claim). */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

/**
 * Verifies a Google Identity Services ID token. We don't run a redirect/auth-code
 * flow: the web gets the ID token client-side and posts it here; we only need to
 * check its signature and that it was minted for OUR client id (audience).
 */
@Injectable()
export class GoogleVerifier {
  private readonly clientId: string;
  private readonly client: OAuth2Client;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('GOOGLE_CLIENT_ID') ?? '';
    this.client = new OAuth2Client(this.clientId);
  }

  async verify(idToken: string): Promise<GoogleProfile> {
    if (!this.clientId) {
      throw new UnauthorizedException({
        code: 'GOOGLE_NOT_CONFIGURED',
        message: 'Login com Google indisponível.',
      });
    }
    let payload;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException({
        code: 'GOOGLE_INVALID_TOKEN',
        message: 'Não foi possível validar o login com o Google.',
      });
    }
    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException({
        code: 'GOOGLE_INVALID_TOKEN',
        message: 'Token do Google incompleto.',
      });
    }
    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified === true,
      name: payload.name ?? null,
      picture: payload.picture ?? null,
    };
  }
}
