import { createTRPCRouter, isAdminUser, protectedProcedure } from '@/server/api/trpc';

export const viewerRouter = createTRPCRouter({
  me: protectedProcedure.query(({ ctx }) => ({
    userId: ctx.auth.userId,
    orgId: ctx.auth.orgId ?? null,
    sessionId: ctx.auth.sessionId ?? null,
    source: ctx.auth.source,
    isAdmin: isAdminUser(ctx.auth.userId)
  }))
});
