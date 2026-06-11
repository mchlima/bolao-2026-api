import { User } from '@prisma/client';

/** User without sensitive fields — safe to return in API responses. */
export type SafeUser = Omit<User, 'passwordHash'>;

export function toSafeUser(user: User): SafeUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}
