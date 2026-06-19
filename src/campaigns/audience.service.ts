import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AudienceCondition, AudienceNode, AudienceSpec, isGroup } from './audience.types';

/**
 * Translates an audience spec (all / boolean filter tree) into a Prisma User
 * where-clause, and resolves the matching count / user ids. The translation is
 * defensive: unknown fields/operators contribute no constraint (never throws on
 * a malformed leaf), so a partially-built filter in the wizard still previews.
 */
@Injectable()
export class AudienceService {
  constructor(private readonly prisma: PrismaService) {}

  buildWhere(spec: AudienceSpec): Prisma.UserWhereInput {
    if (spec.all || !spec.filter) return {};
    return this.translate(spec.filter);
  }

  count(spec: AudienceSpec): Promise<number> {
    return this.prisma.user.count({ where: this.buildWhere(spec) });
  }

  async resolveUserIds(spec: AudienceSpec): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: this.buildWhere(spec),
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private translate(node: AudienceNode): Prisma.UserWhereInput {
    if (isGroup(node)) {
      const kids = (node.children ?? [])
        .map((c) => this.translate(c))
        .filter((w) => Object.keys(w).length > 0);
      if (!kids.length) return {};
      return node.op === 'or' ? { OR: kids } : { AND: kids };
    }
    return this.leaf(node);
  }

  private leaf(c: AudienceCondition): Prisma.UserWhereInput {
    switch (c.field) {
      case 'followsTeam': {
        const ids = asStringArray(c.value);
        if (!ids.length) return {};
        return c.operator === 'none'
          ? { followedTeams: { none: { teamId: { in: ids } } } }
          : { followedTeams: { some: { teamId: { in: ids } } } };
      }
      case 'role': {
        const role = c.value === 'ADMIN' ? 'ADMIN' : 'USER';
        return c.operator === 'neq' ? { role: { not: role } } : { role };
      }
      case 'isActive':
        return { isActive: c.value !== false };
      case 'pushEnabled':
        return c.value === false
          ? { pushSubscriptions: { none: {} } }
          : { pushSubscriptions: { some: {} } };
      case 'inPool':
        return c.value === false
          ? { poolMemberships: { none: {} } }
          : { poolMemberships: { some: {} } };
      case 'hasPredicted':
        return c.value === false
          ? { predictions: { none: {} } }
          : { predictions: { some: {} } };
      case 'timezone': {
        const tzs = asStringArray(c.value);
        if (!tzs.length) return {};
        return c.operator === 'notin'
          ? { timezone: { notIn: tzs } }
          : { timezone: { in: tzs } };
      }
      case 'createdAt': {
        const d = typeof c.value === 'string' ? new Date(c.value) : null;
        if (!d || Number.isNaN(d.getTime())) return {};
        return c.operator === 'before' ? { createdAt: { lt: d } } : { createdAt: { gt: d } };
      }
      default:
        return {};
    }
  }
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && !!x);
  if (typeof v === 'string' && v) return [v];
  return [];
}
