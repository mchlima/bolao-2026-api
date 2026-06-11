import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SafeUser } from '../../users/user.types';

/** Inject the authenticated user (set by JwtStrategy) into a handler param. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SafeUser => {
    return ctx.switchToHttp().getRequest<{ user: SafeUser }>().user;
  },
);
