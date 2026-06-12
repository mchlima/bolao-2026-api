import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User, UserRole } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Paginated, paginated } from '../common/pagination';
import { SafeUser } from './user.types';

// Projection that never exposes passwordHash.
const SAFE_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  timezone: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export interface QueryUsersParams {
  page: number;
  pageSize: number;
  search?: string;
  role?: UserRole;
  isActive?: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(data: {
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<User> {
    return this.prisma.user.create({ data });
  }

  // ─────────────── Admin ───────────────

  async findAllPaginated(
    query: QueryUsersParams,
  ): Promise<Paginated<SafeUser>> {
    const { page, pageSize, search, role, isActive } = query;
    const where: Prisma.UserWhereInput = {
      ...(role && { role }),
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: SAFE_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginated(data, total, page, pageSize);
  }

  async setRole(
    id: string,
    role: UserRole,
    actorUserId: string,
  ): Promise<SafeUser> {
    const user = await this.getOrThrow(id);
    if (user.id === actorUserId && role !== UserRole.ADMIN) {
      throw new ForbiddenException({
        code: 'CANNOT_DEMOTE_SELF',
        message: 'Você não pode rebaixar a si mesmo.',
      });
    }
    if (user.role === role) return strip(user);

    const updated = await this.prisma.user.update({
      where: { id },
      data: { role },
      select: SAFE_SELECT,
    });
    await this.audit.record({
      actorUserId,
      action: 'USER_SET_ROLE',
      entityType: 'User',
      entityId: id,
      diff: { role: { before: user.role, after: role } },
    });
    return updated;
  }

  async setActive(
    id: string,
    isActive: boolean,
    actorUserId: string,
  ): Promise<SafeUser> {
    const user = await this.getOrThrow(id);
    if (user.id === actorUserId && !isActive) {
      throw new ForbiddenException({
        code: 'CANNOT_DEACTIVATE_SELF',
        message: 'Você não pode desativar a si mesmo.',
      });
    }
    if (user.isActive === isActive) return strip(user);

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: SAFE_SELECT,
    });
    await this.audit.record({
      actorUserId,
      action: 'USER_SET_ACTIVE',
      entityType: 'User',
      entityId: id,
      diff: { isActive: { before: user.isActive, after: isActive } },
    });
    return updated;
  }

  /**
   * Generate a new temporary password (no email service yet — returned ONCE to the
   * admin to relay). Decision #4: migrate to a reset-link flow when email exists.
   */
  async resetPassword(
    id: string,
    actorUserId: string,
  ): Promise<{ user: SafeUser; temporaryPassword: string }> {
    const user = await this.getOrThrow(id);
    const temporaryPassword = randomBytes(9).toString('base64url'); // ~12 chars
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await hash(temporaryPassword, 10) },
    });
    await this.audit.record({
      actorUserId,
      action: 'USER_RESET_PASSWORD',
      entityType: 'User',
      entityId: id,
    });
    return { user: strip(user), temporaryPassword };
  }

  updateProfile(id: string, data: { timezone?: string }): Promise<SafeUser> {
    return this.prisma.user.update({
      where: { id },
      data,
      select: SAFE_SELECT,
    });
  }

  private async getOrThrow(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Usuário não encontrado.',
      });
    }
    return user;
  }
}

function strip(user: User): SafeUser {
  const { passwordHash: _omit, ...safe } = user;
  return safe;
}
