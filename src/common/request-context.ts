import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request network/geo context, populated by RequestContextMiddleware from
 * the Cloudflare/proxy headers and read by AuditService so sensitive actions
 * record where they came from without every call site threading the request.
 */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The current request's context, or undefined outside a request (e.g. cron). */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
