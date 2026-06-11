import { UserRole } from '@prisma/client';

/** Shape of the signed JWT payload. */
export interface JwtPayload {
  sub: string; // user id
  role: UserRole;
}
