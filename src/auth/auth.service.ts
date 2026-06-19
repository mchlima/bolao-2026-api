import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditActorType, User } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { StorageService } from '../storage/storage.service';
import { SafeUser, toSafeUser } from '../users/user.types';
import { AuditService, RecordAuditParams } from '../audit/audit.service';
import { JwtPayload } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { GoogleVerifier } from './google-verifier';

const BCRYPT_ROUNDS = 10;

export interface AuthResponse {
  accessToken: string;
  user: SafeUser;
}

export interface AccountConnections {
  google: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly google: GoogleVerifier,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'E-mail já cadastrado.',
      });
    }
    const passwordHash = await hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.users.create({
      name: dto.name,
      email: dto.email,
      passwordHash,
    });
    await this.safeAudit({
      actorUserId: user.id,
      action: 'AUTH_REGISTER',
      entityType: 'User',
      entityId: user.id,
    });
    return this.buildResponse(user);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.users.findByEmail(dto.email);
    const passwordOk =
      user?.passwordHash != null &&
      (await compare(dto.password, user.passwordHash));

    // Same error for "no such user" and "wrong password" — avoid user enumeration.
    if (!user || !passwordOk) {
      await this.safeAudit({
        actorUserId: user?.id ?? null,
        actorType: AuditActorType.SYSTEM,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'User',
        entityId: user?.id,
        diff: { email: dto.email, reason: 'INVALID_CREDENTIALS' },
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'E-mail ou senha inválidos.',
      });
    }
    if (!user.isActive) {
      await this.safeAudit({
        actorUserId: user.id,
        actorType: AuditActorType.SYSTEM,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        diff: { email: dto.email, reason: 'USER_INACTIVE' },
      });
      throw new ForbiddenException({
        code: 'USER_INACTIVE',
        message: 'Usuário desativado.',
      });
    }
    await this.safeAudit({
      actorUserId: user.id,
      action: 'AUTH_LOGIN',
      entityType: 'User',
      entityId: user.id,
    });
    return this.buildResponse(user);
  }

  /**
   * Login OR signup with Google (one flow — Google doesn't distinguish them):
   *   1. Already linked → log that user in.
   *   2. Email matches an existing account → auto-link (Google verified the email)
   *      and log in. If the email is NOT verified by Google, refuse and steer the
   *      user to log in with their password and link from the profile.
   *   3. Brand-new email → create a passwordless account linked to Google.
   */
  async loginWithGoogle(dto: GoogleAuthDto): Promise<AuthResponse> {
    const profile = await this.google.verify(dto.idToken);

    let user = await this.users.findByOAuth('google', profile.sub);
    if (!user) {
      const byEmail = await this.users.findByEmail(profile.email);
      if (byEmail) {
        if (!profile.emailVerified) {
          throw new ConflictException({
            code: 'EMAIL_TAKEN',
            message:
              'Já existe uma conta com este e-mail. Entre com a senha e vincule o Google no seu perfil.',
          });
        }
        await this.users.linkOAuth(byEmail.id, {
          provider: 'google',
          providerAccountId: profile.sub,
          email: profile.email,
        });
        user = byEmail;
        await this.safeAudit({
          actorUserId: user.id,
          action: 'AUTH_GOOGLE_LINK',
          entityType: 'User',
          entityId: user.id,
          diff: { via: 'login_auto' },
        });
      } else {
        user = await this.users.createWithOAuth({
          name: profile.name?.trim() || profile.email.split('@')[0],
          email: profile.email,
          avatarUrl: profile.picture,
          provider: 'google',
          providerAccountId: profile.sub,
          providerEmail: profile.email,
        });
        await this.safeAudit({
          actorUserId: user.id,
          action: 'AUTH_GOOGLE_REGISTER',
          entityType: 'User',
          entityId: user.id,
        });
      }
    }

    if (!user.isActive) {
      await this.safeAudit({
        actorUserId: user.id,
        actorType: AuditActorType.SYSTEM,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        diff: { email: profile.email, reason: 'USER_INACTIVE' },
      });
      throw new ForbiddenException({
        code: 'USER_INACTIVE',
        message: 'Usuário desativado.',
      });
    }

    await this.safeAudit({
      actorUserId: user.id,
      action: 'AUTH_GOOGLE_LOGIN',
      entityType: 'User',
      entityId: user.id,
    });
    return this.buildResponse(user);
  }

  /** Link a Google identity to the currently authenticated user. */
  async linkGoogle(
    userId: string,
    dto: GoogleAuthDto,
  ): Promise<AccountConnections> {
    const profile = await this.google.verify(dto.idToken);
    const owner = await this.users.findByOAuth('google', profile.sub);
    if (owner && owner.id !== userId) {
      throw new ConflictException({
        code: 'GOOGLE_ALREADY_LINKED',
        message: 'Esta conta Google já está vinculada a outro usuário.',
      });
    }
    if (!owner) {
      await this.users.linkOAuth(userId, {
        provider: 'google',
        providerAccountId: profile.sub,
        email: profile.email,
      });
      await this.safeAudit({
        actorUserId: userId,
        action: 'AUTH_GOOGLE_LINK',
        entityType: 'User',
        entityId: userId,
      });
    }
    return this.users.getConnections(userId);
  }

  getConnections(userId: string): Promise<AccountConnections> {
    return this.users.getConnections(userId);
  }

  /** Audit must never break auth — swallow any logging failure. */
  private async safeAudit(params: RecordAuditParams): Promise<void> {
    try {
      await this.audit.record(params);
    } catch {
      // best-effort: a failed audit insert must not block login/registration
    }
  }

  async updateMe(
    userId: string,
    dto: { name?: string; timezone?: string },
  ): Promise<SafeUser> {
    const data: { name?: string; timezone?: string } = {};

    if (dto.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: dto.timezone });
      } catch {
        throw new BadRequestException({
          code: 'INVALID_TIMEZONE',
          message: 'Fuso horário inválido.',
        });
      }
      data.timezone = dto.timezone;
    }

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException({
          code: 'INVALID_NAME',
          message: 'Informe um nome.',
        });
      }
      data.name = name;
    }

    return this.users.updateProfile(userId, data);
  }

  /**
   * Replace the user's profile photo: optimize+upload the new image, point the
   * account at it, then delete the previous object (best-effort) so R2 doesn't
   * accumulate orphans.
   */
  async setAvatar(
    userId: string,
    file: { buffer: Buffer },
  ): Promise<SafeUser> {
    const current = await this.users.findById(userId);
    const url = await this.storage.uploadImage(file.buffer, 'avatars');
    const updated = await this.users.updateProfile(userId, { avatarUrl: url });
    await this.storage.deleteByUrl(current?.avatarUrl);
    return updated;
  }

  async removeAvatar(userId: string): Promise<SafeUser> {
    const current = await this.users.findById(userId);
    const updated = await this.users.updateProfile(userId, { avatarUrl: null });
    await this.storage.deleteByUrl(current?.avatarUrl);
    return updated;
  }

  private buildResponse(user: User): AuthResponse {
    const payload: JwtPayload = { sub: user.id, role: user.role };
    return {
      accessToken: this.jwt.sign(payload),
      user: toSafeUser(user),
    };
  }
}
