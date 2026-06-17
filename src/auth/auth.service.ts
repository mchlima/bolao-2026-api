import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { StorageService } from '../storage/storage.service';
import { SafeUser, toSafeUser } from '../users/user.types';
import { JwtPayload } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const BCRYPT_ROUNDS = 10;

export interface AuthResponse {
  accessToken: string;
  user: SafeUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly storage: StorageService,
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
    return this.buildResponse(user);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.users.findByEmail(dto.email);
    const passwordOk =
      user?.passwordHash != null &&
      (await compare(dto.password, user.passwordHash));

    // Same error for "no such user" and "wrong password" — avoid user enumeration.
    if (!user || !passwordOk) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'E-mail ou senha inválidos.',
      });
    }
    if (!user.isActive) {
      throw new ForbiddenException({
        code: 'USER_INACTIVE',
        message: 'Usuário desativado.',
      });
    }
    return this.buildResponse(user);
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
