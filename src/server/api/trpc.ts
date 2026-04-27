import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { sql } from '@/server/db/client';

type ApiAuthContext = {
  userId: string | null;
  orgId: string | null;
  sessionId: string | null;
  source: 'clerk' | 'dev-header' | 'anonymous';
};

async function resolveAuthContext(headers: Headers): Promise<ApiAuthContext> {
  const clerkAuth = await auth();

  if (clerkAuth.userId) {
    return {
      userId: clerkAuth.userId,
      orgId: clerkAuth.orgId ?? null,
      sessionId: clerkAuth.sessionId ?? null,
      source: 'clerk'
    };
  }

  const devAuthEnabled =
    process.env.NODE_ENV !== 'production' && process.env.TRPC_DEV_AUTH_ENABLED === '1';
  const devAuthToken = process.env.TRPC_DEV_AUTH_TOKEN;
  const devUserId = headers.get('x-dev-user-id')?.trim();
  const requestDevAuthToken = headers.get('x-dev-auth-token');

  if (devAuthEnabled && devAuthToken && devUserId && requestDevAuthToken === devAuthToken) {
    return {
      userId: devUserId,
      orgId: headers.get('x-dev-org-id')?.trim() || null,
      sessionId: 'dev-header-session',
      source: 'dev-header'
    };
  }

  return {
    userId: null,
    orgId: null,
    sessionId: null,
    source: 'anonymous'
  };
}

export async function createTRPCContext(opts: { headers: Headers }) {
  return {
    auth: await resolveAuthContext(opts.headers),
    db: sql,
    headers: opts.headers
  };
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson
});

function getAdminUserIds() {
  return new Set(
    (process.env.CLERK_ADMIN_USERS ?? '')
      .split(',')
      .map((userId) => userId.trim())
      .filter(Boolean)
  );
}

export function isAdminUser(userId: string | null) {
  return Boolean(userId && getAdminUserIds().has(userId));
}

export const createCallerFactory = t.createCallerFactory;
export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth.userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Clerk authentication is required'
    });
  }

  return next({
    ctx: {
      ...ctx,
      auth: {
        ...ctx.auth,
        userId: ctx.auth.userId
      }
    }
  });
});

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isAdminUser(ctx.auth.userId)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin privileges are required'
    });
  }

  return next({ ctx });
});
